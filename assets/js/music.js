/* ==========================================================================
   attachmenttoolarge — 主题音乐引擎
   浏览器实时合成（Web Audio），不加载任何音频文件、不联网、不上传数据。

   两条曲目：
   1) lofi  《19:59 的发送失败》 — A 小调 84 BPM，Am–F–C–G，柔和 pad + 走低音 + 琶音
   2) rap   《附件太大》        — 88 BPM boom-bap 鼓组 + 磁带底噪，
                                  人声由系统语音合成（speechSynthesis）按行朗读，
                                  并逐句高亮歌词（卡拉OK）。

   音效：550 报错下坠音、复制成功提示音、418 彩蛋哨音。
   默认静音，必须由用户点击才会出声。

   ★ 想让 Rap 换成真人/AI 原声（Suno、ElevenLabs 等）：
     把音频放到 assets/audio/rap.mp3 并告知，即可让系统朗读自动让位。
   ========================================================================== */
(function () {
  "use strict";

  var STORE_ON = "att.music.on";
  var STORE_VOL = "att.music.vol";
  var STORE_TRACK = "att.music.track";
  var STORE_MUTED = "att.music.muted";
  var STORE_VOICE = "att.music.voice";
  var STORE_OWNER = "att.music.owner";

  /* ======================= 静音与「谁在放」仲裁 =======================
     两个真实出现过的问题：
     1. 用户在多个标签页打开本站，每个标签页各放一份循环 → 听起来像「重复的声音」。
        解决：谁先播谁持有 att.music.owner，其他标签页收到通知立刻停。
     2. 用户想彻底关掉，但只找到暂停键，刷新后还可能被再次点开。
        解决：?sound=off（或 #sound=off）与界面上的 ✕ 都会写死静音标记，
        静音状态下 start() 直接拒绝执行，连 AudioContext 都不创建。 */
  var TAB_ID = Math.random().toString(36).slice(2);
  var channel = null;
  var hardMuted = false;

  function isMuted() {
    if ((location.search + location.hash).toLowerCase().indexOf("sound=off") !== -1) return true;
    if ((location.search + location.hash).toLowerCase().indexOf("mute") !== -1) return true;
    return store(STORE_MUTED) === "1";
  }

  function setMuted(on) {
    hardMuted = !!on;
    store(STORE_MUTED, on ? "1" : "0");
    if (on) { stop(); releaseClaim(); }
    syncUI();
  }

  function setupChannel() {
    try {
      if (typeof BroadcastChannel === "function" && !channel) {
        channel = new BroadcastChannel("att-music");
        channel.onmessage = function (e) {
          var msg = e.data || {};
          if (msg.from === TAB_ID) return;
          if (msg.type === "claim" && state.on) {
            // 另一个标签页开始播放了，这一页让位，避免两个循环叠在一起
            stop();
            if (ui) ui.classList.add("is-yielded");
          }
          if (msg.type === "suspend" && state.on) stop();
        };
      }
    } catch (e) { channel = null; }
  }

  function claim() { store(STORE_OWNER, TAB_ID); if (channel) channel.postMessage({ type: "claim", from: TAB_ID }); }
  function releaseClaim() {
    if (store(STORE_OWNER) === TAB_ID) store(STORE_OWNER, "");
    if (channel) channel.postMessage({ type: "release", from: TAB_ID });
  }
  function ownsTab() { return store(STORE_OWNER) === TAB_ID || !store(STORE_OWNER); }

  /* ======================= 曲目一：lo-fi ======================= */
  var TEMPO = 84;
  var BEAT = 60 / TEMPO;
  var STEP = BEAT / 2;          // 八分音符
  var STEPS_PER_CHORD = 16;     // 每个和弦两小节
  var CHORDS = [
    { pad: [220.00, 261.63, 329.63], bass: 110.00, arp: [220.00, 261.63, 329.63, 440.00] },
    { pad: [174.61, 220.00, 261.63], bass: 87.31,  arp: [174.61, 220.00, 261.63, 349.23] },
    { pad: [196.00, 261.63, 329.63], bass: 130.81, arp: [261.63, 329.63, 392.00, 523.25] },
    { pad: [196.00, 246.94, 293.66], bass: 98.00,  arp: [196.00, 246.94, 293.66, 392.00] }
  ];
  var TOTAL_STEPS = CHORDS.length * STEPS_PER_CHORD;
  var LOOP_SECONDS = TOTAL_STEPS * STEP;

  /* ======================= 曲目二：rap 鼓组 ======================= */
  var RAP_BPM = 88;
  var RAP_BEAT = 60 / RAP_BPM;
  var RAP_STEP = RAP_BEAT / 4;  // 十六分音符
  var RAP_BAR = 16;             // 一小节 = 16 个十六分音符
  var RAP_BASS = [110.00, 87.31, 130.81, 98.00];  // Am – F – C – G，每小节一个根音
  /* 每行歌词给两小节，够系统语音从容念完，也留出呼吸 */
  var RAP_LINE_BARS = 2;

  /* ======================= 工具 ======================= */
  function store(key, val) {
    try {
      if (val === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, val);
    } catch (e) { /* 隐私模式忽略 */ }
    return null;
  }

  function noiseBuffer(ctx) {
    var len = Math.floor(ctx.sampleRate * 0.5);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /* ======================= 总线 ======================= */
  function createBuses(ctx, dest) {
    var master = ctx.createGain();
    master.gain.value = 0.0001;

    var sfx = ctx.createGain();
    sfx.gain.value = 1;

    var lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 3400;
    lp.Q.value = 0.4;

    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 24;
    comp.ratio.value = 3;
    comp.attack.value = 0.006;
    comp.release.value = 0.24;

    var delay = ctx.createDelay(1.2);
    delay.delayTime.value = STEP * 3;
    var fb = ctx.createGain();
    fb.gain.value = 0.12;                     // 反馈收小：不再拖出金属味的余响
    var wet = ctx.createGain();
    wet.gain.value = 0.16;

    delay.connect(fb);
    fb.connect(delay);
    delay.connect(wet);
    wet.connect(lp);

    master.connect(lp);
    sfx.connect(lp);
    lp.connect(comp);
    comp.connect(dest);

    return { master: master, sfx: sfx, delay: delay, noise: noiseBuffer(ctx) };
  }

  /* ======================= 乐器：lo-fi ======================= */
  function pad(ctx, b, freqs, t, dur) {
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.13, t + 0.9);
    g.gain.setValueAtTime(0.13, t + dur - 1.0);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);

    var f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 1200;                 // 更暗、更靠后：它是背景，不是主体

    freqs.forEach(function (fr) {
      // 只留三角波与正弦。锯齿波会有嗡嗡的毛刺感，那是「杂音」的来源之一。
      [0, 1].forEach(function (k) {
        var o = ctx.createOscillator();
        o.type = k ? "sine" : "triangle";
        o.frequency.value = fr * (k ? 0.5 : 1);   // 低八度正弦垫底
        var vg = ctx.createGain();
        vg.gain.value = k ? 0.45 : 0.75;
        o.connect(vg);
        vg.connect(f);
        o.start(t);
        o.stop(t + dur + 0.15);
      });
    });

    f.connect(g);
    g.connect(b.master);
  }

  function bass(ctx, b, fr, t, dur, level) {
    var o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = fr;

    var o2 = ctx.createOscillator();
    o2.type = "triangle";
    o2.frequency.value = fr * 2;

    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level || 0.45, t + 0.035);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    var g2 = ctx.createGain();
    g2.gain.value = 0.12;

    var f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 430;

    o.connect(g);
    o2.connect(g2);
    g2.connect(g);
    g.connect(f);
    f.connect(b.master);

    o.start(t); o.stop(t + dur + 0.06);
    o2.start(t); o2.stop(t + dur + 0.06);
  }

  function arp(ctx, b, fr, t, vel) {
    var o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = fr;

    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.07 * vel, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);

    o.connect(g);
    g.connect(b.master);
    g.connect(b.delay);

    o.start(t);
    o.stop(t + 0.4);
  }

  function hat(ctx, b, t, vel) {
    var s = ctx.createBufferSource();
    s.buffer = b.noise;

    var f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 6800;

    var g = ctx.createGain();
    g.gain.setValueAtTime(0.026 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);

    s.connect(f);
    f.connect(g);
    g.connect(b.master);
    s.start(t);
    s.stop(t + 0.09);
  }

  function kick(ctx, b, t) {
    var o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(132, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.14);

    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);

    o.connect(g);
    g.connect(b.master);
    o.start(t);
    o.stop(t + 0.34);
  }

  /* ======================= 乐器：rap 鼓组 ======================= */
  function snare(ctx, b, t) {
    var s = ctx.createBufferSource();
    s.buffer = b.noise;

    var f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 1750;
    f.Q.value = 0.9;

    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);

    var o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(122, t + 0.08);

    var og = ctx.createGain();
    og.gain.setValueAtTime(0.085, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);

    s.connect(f); f.connect(g); g.connect(b.master);
    o.connect(og); og.connect(b.master);
    s.start(t); s.stop(t + 0.22);
    o.start(t); o.stop(t + 0.12);
  }

  function crackle(ctx, b) {
    var s = ctx.createBufferSource();
    s.buffer = b.noise;
    s.loop = true;

    var f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 3000;
    f.Q.value = 0.5;

    var g = ctx.createGain();
    g.gain.value = 0.011;

    s.connect(f); f.connect(g); g.connect(b.master);
    s.start();
    return s;
  }

  /* ======================= 排程 ======================= */
  function scheduleLofiStep(ctx, b, step, t) {
    var chord = CHORDS[Math.floor(step / STEPS_PER_CHORD) % CHORDS.length];
    var local = step % STEPS_PER_CHORD;

    if (local === 0) pad(ctx, b, chord.pad, t, STEPS_PER_CHORD * STEP);
    if (local === 0 || local === 8) bass(ctx, b, chord.bass, t, STEP * 7);
    if (local % 2 === 0) arp(ctx, b, chord.arp[(local / 2) % chord.arp.length], t, 0.6 + Math.random() * 0.25);
    /* 刻意不放鼓：没有重音、没有噪声打击乐。
       这是一条可以一直循环下去的背景铺底：和声垫 + 低音 + 琶音。 */
  }

  function scheduleRapStep(ctx, b, step, t) {
    var bar = Math.floor(step / RAP_BAR);
    var local = step % RAP_BAR;
    var root = RAP_BASS[bar % RAP_BASS.length];
    var fill = bar % 4 === 3;   // 每四小节加一点花

    if (local === 0 || local === 7 || local === 10 || (fill && local === 14)) {
      kick(ctx, b, t);
      bass(ctx, b, root, t, RAP_STEP * 2.6, 0.42);
    }
    if (local === 4 || local === 12) snare(ctx, b, t);
    if (local % 2 === 0) hat(ctx, b, t, local % 4 === 0 ? 0.72 : 0.42);
    if (local === 3 || local === 11) hat(ctx, b, t, 0.28);
  }

  /* ======================= 曲目三：The Long Send（后摇）=======================
     上一版是错的，得说清楚错在哪：它用了和背景铺底一样的三种音色（和声垫、
     走低音、三角波琶音），鼓又埋得太深，所以听上去和第一首没有区别 —— 换了
     标签，没换音乐。这一版从音色到结构全部重写。

     后摇的性格是「渐强」：八小节一循环，每两小节进一层
       0–1 小节  干净的延迟琶音 + 和声垫，没有鼓
       2–3 小节  + 贝斯、软底鼓、高音铃铛
       4–5 小节  + 颤音吉他十六分、军鼓、踩镲
       6–7 小节  全奏：推进的底鼓、反拍军鼓、失真高频层，末小节上升后回到开头
     E 小调，92 BPM，loop 点上有镲片与噪声涌浪做接缝。 */
  var POST_BPM = 92;
  var POST_BEAT = 60 / POST_BPM;
  var POST_STEP = POST_BEAT / 4;
  var POST_BAR = 16;              // 一小节 = 16 个十六分音符
  var POST_BARS = 8;              // 八小节渐强
  var POST_CHORDS = [
    [164.81, 196.00, 246.94],     // Em
    [146.83, 174.61, 220.00],     // D
    [130.81, 164.81, 196.00],     // C
    [146.83, 174.61, 220.00]      // D
  ];
  var POST_ARP = [329.63, 392.00, 493.88, 659.25];                 // E4 G4 B4 E5
  var POST_TREMS = [164.81, 196.00, 246.94, 329.63, 392.00, 493.88];

  /* 颤音吉他：明亮锯齿，快速起落，送进延迟总线做出后摇的那种余响 */
  function tremolo(ctx, b, fr, t, level) {
    var f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 5200;              // 明亮才是后摇的吉他
    f.Q.value = 1.2;

    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.11 * level, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);

    var o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = fr;
    o.connect(f);
    f.connect(g);
    g.connect(b.master);
    g.connect(b.delay);
    o.start(t);
    o.stop(t + 0.2);
  }

  /* 铃音：正弦加一个高次泛音，尾巴长 */
  function bell(ctx, b, fr, t) {
    [1, 2.76].forEach(function (mult, k) {
      var o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = fr * mult;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(k ? 0.016 : 0.05, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (k ? 1.0 : 1.6));
      o.connect(g);
      g.connect(b.master);
      o.start(t);
      o.stop(t + 1.8);
    });
  }

  /* 噪声涌浪：频带从 400 扫到 4000，把乐句推向下一圈 */
  function swell(ctx, b, t) {
    var s = ctx.createBufferSource();
    s.buffer = b.noise;
    var f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 0.8;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(4000, t + 1.1);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.08, t + 1.0);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.25);
    s.connect(f);
    f.connect(g);
    g.connect(b.master);
    s.start(t);
    s.stop(t + 1.3);
  }

  /* 镲片：高通噪声，长衰减，用来缝住 loop 接点 */
  function crash(ctx, b, t) {
    var s = ctx.createBufferSource();
    s.buffer = b.noise;
    var f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 4200;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.085, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    s.connect(f);
    f.connect(g);
    g.connect(b.master);
    s.start(t);
    s.stop(t + 1.5);
  }

  /* ---- 怪奇物语语汇：低音脉冲琶音 + 失谐长鸣 + 滴答脉冲 ----
     那部剧的招牌就是这三样：八分音符的合成器脉冲在低音区不停走、
     两层微微失谐的长鸣制造不安、以及像倒计时一样的高频滴答。 */

  /* 脉冲：八分音符，低通随小节慢慢打开，带一点下滑 */
  function stPulse(ctx, b, fr, t, level) {
    var o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(fr * 1.012, t);
    o.frequency.exponentialRampToValueAtTime(fr, t + 0.16);

    var f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(700, t);
    f.frequency.linearRampToValueAtTime(1800, t + 0.05);
    f.frequency.exponentialRampToValueAtTime(520, t + 0.22);
    f.Q.value = 5;                        // 高 Q 才有那种"哨"味

    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.085 * level, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);

    o.connect(f); f.connect(g); g.connect(b.master);
    o.start(t); o.stop(t + 0.3);
  }

  /* 失谐长鸣：两个锯齿差 7 音分，慢慢进来，不收尾（靠下一层盖掉） */
  function stDrone(ctx, b, fr, t, dur) {
    var f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 900;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.035, t + 1.2);
    g.gain.setValueAtTime(0.035, t + dur - 0.8);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    [0, 7].forEach(function (cents) {
      var o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = fr * Math.pow(2, cents / 1200);
      var vg = ctx.createGain();
      vg.gain.value = 0.5;
      o.connect(vg); vg.connect(f);
      o.start(t); o.stop(t + dur + 0.1);
    });
    f.connect(g); g.connect(b.master);
  }

  /* 滴答：窄带高频短促脉冲，像倒计时 */
  function stTick(ctx, b, t, level) {
    var o = ctx.createOscillator();
    o.type = "square";
    o.frequency.value = 1864.66;          // 升 A6，故意和 E 小调不协和
    var f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 1864.66;
    f.Q.value = 12;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.03 * level, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(f); f.connect(g); g.connect(b.master);
    o.start(t); o.stop(t + 0.12);
  }
  /* 失真高频层：两层锯齿过扫频低通，做全奏段的那层"墙" */
  function stab(ctx, b, freqs, t) {
    var f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(1200, t);
    f.frequency.linearRampToValueAtTime(3400, t + 0.04);
    f.frequency.exponentialRampToValueAtTime(900, t + 0.6);
    f.Q.value = 2.4;

    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.055, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);

    freqs.forEach(function (fr) {
      [0, 1].forEach(function (k) {
        var o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = fr * (k ? 1.005 : 1);
        var vg = ctx.createGain();
        vg.gain.value = 0.5;
        o.connect(vg);
        vg.connect(f);
        o.start(t);
        o.stop(t + 0.7);
      });
    });
    f.connect(g);
    g.connect(b.master);
  }

  /* --------------------------------------------------------------------------
     The Long Send 自己的三个声部。它以前直接调用第一首的 pad()/bass()/arp()，
     所以频谱和第一首几乎重合 —— 加再多的鼓也只是在同一副骨架上盖层。这三个
     函数是它独有的：低通弦乐墙、纯正弦超低音、三角拨弦，能量分布落在完全
     不同的位置。
     -------------------------------------------------------------------------- */
  function postBed(ctx, b, freqs, t, dur) {
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.11, t + dur * 0.35);      // 慢慢涨，这是"墙"
    g.gain.setValueAtTime(0.11, t + dur - 1.2);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);

    var f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 620;                                   // 关键：把能量压到中低频
    f.Q.value = 0.7;

    var lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.12;                                // 极慢的呼吸
    var lfoGain = ctx.createGain();
    lfoGain.gain.value = 140;
    lfo.connect(lfoGain);
    lfoGain.connect(f.frequency);
    lfo.start(t); lfo.stop(t + dur + 0.2);

    freqs.forEach(function (fr) {
      [0, 9].forEach(function (cents) {                        // 差 9 音分：厚而不颤
        var o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = fr * Math.pow(2, cents / 1200);
        var vg = ctx.createGain();
        vg.gain.value = 0.5;
        o.connect(vg); vg.connect(f);
        o.start(t); o.stop(t + dur + 0.2);
      });
    });
    f.connect(g);
    g.connect(b.master);
  }

  function postSub(ctx, b, fr, t, dur) {
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.30, t + 0.03);            // 纯正弦：低频段的支柱
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    var o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(fr * 0.985, t);                 // 轻微下滑，像弓弦落定
    o.frequency.linearRampToValueAtTime(fr, t + 0.25);
    o.connect(g);
    g.connect(b.master);
    o.start(t); o.stop(t + dur + 0.1);
  }

  function postPluck(ctx, b, fr, t, vel) {
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.10 * (vel || 1), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    var f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 2400;                                  // 比颤音吉他暗一档
    var o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = fr;
    o.connect(f); f.connect(g);
    g.connect(b.master);
    g.connect(b.delay);
    o.start(t); o.stop(t + 1.0);
  }

  /* ======================= 曲目六：The Twenty-Megabyte Line（美式民谣）=========
     这是自己写的一首，不是把远程生成的碎片缝起来 —— 上一版把十二段五秒的
     片段首尾相接，每段和声与速度都不同，那不是一首曲子。
     Karplus-Strong 拨弦（噪声脉冲 + 延迟反馈）正是民谣吉他与五弦班卓的音色，
     配走步低音、口琴式长音与三度和声。G–C–G–D 循环，四小节一句。 */
  var FOLK_BPM = 104, FOLK_BEAT = 60 / FOLK_BPM, FOLK_STEP = FOLK_BEAT / 2, FOLK_BAR = 8;
  var FOLK_CHORDS = [
    { root: 196.00, third: 246.94, fifth: 293.66, harm: 493.88 },   // G
    { root: 130.81, third: 164.81, fifth: 196.00, harm: 392.00 },   // C
    { root: 196.00, third: 246.94, fifth: 293.66, harm: 493.88 },   // G
    { root: 146.83, third: 185.00, fifth: 220.00, harm: 440.00 }    // D
  ];

  /* 拨弦：一段很短的噪声送进与音高等长的延迟线，反馈里带一阶衰减 —— 这就是弦 */
  function pluck(ctx, b, fr, t, vel) {
    var out = ctx.createGain();
    out.gain.setValueAtTime(0.16 * (vel || 1), t);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);

    var delay = ctx.createDelay(0.05);
    delay.delayTime.value = 1 / fr;
    var fb = ctx.createGain();
    fb.gain.value = 0.965;                      // 弦的衰减
    var damp = ctx.createBiquadFilter();
    damp.type = "lowpass";
    damp.frequency.value = Math.min(4200, fr * 9);   // 高音衰减得比低音快，才有拨弦味

    var burst = ctx.createBufferSource();
    burst.buffer = b.noise;
    var bg = ctx.createGain();
    bg.gain.setValueAtTime(1, t);
    bg.gain.exponentialRampToValueAtTime(0.001, t + 1 / fr);   // 只喂一个周期

    burst.connect(bg); bg.connect(delay);
    delay.connect(damp); damp.connect(fb); fb.connect(delay);
    delay.connect(out);
    out.connect(b.master);
    burst.start(t); burst.stop(t + 0.05);
  }

  /* 口琴：三角波过带通，加一点颤音，长音拖住整句 */
  function harmonica(ctx, b, fr, t, dur) {
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.12);
    g.gain.setValueAtTime(0.07, t + dur - 0.2);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    var f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = fr * 2;
    f.Q.value = 1.6;
    var o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = fr;
    var vib = ctx.createOscillator();
    vib.type = "sine";
    vib.frequency.value = 5.2;                  // 手的颤音
    var vg = ctx.createGain();
    vg.gain.value = fr * 0.012;
    vib.connect(vg); vg.connect(o.frequency);
    o.connect(f); f.connect(g); g.connect(b.master);
    o.start(t); vib.start(t);
    o.stop(t + dur + 0.05); vib.stop(t + dur + 0.05);
  }

  function scheduleFolkStep(ctx, b, step, t) {
    var bar = Math.floor(step / FOLK_BAR);
    var local = step % FOLK_BAR;
    var c = FOLK_CHORDS[bar % FOLK_CHORDS.length];
    var phrase = bar % 4;

    /* 指弹：根-三-五-三 的八分音型，每小节两遍，力度起伏像手在动 */
    var fig = [c.root, c.third, c.fifth, c.third];
    var note = fig[local % 4];
    if (local % 2 === 0) {
      var oct = (local === 4 || local === 6) ? 2 : 1;
      pluck(ctx, b, note * oct, t, 0.75 + (local % 4 === 0 ? 0.25 : 0));
    }
    /* 班卓：反拍上的高八度短拨 */
    if (local % 2 === 1) pluck(ctx, b, c.fifth * 2, t, 0.35);

    /* 走步低音：一小节两下，根音与五度 */
    if (local === 0 || local === 4) {
      bass(ctx, b, (local === 0 ? c.root : c.fifth) / 2, t, FOLK_STEP * 3.2, 0.34);
    }

    /* 口琴：每四小节进来一次，吹一整句 */
    if (local === 0 && (phrase === 0 || phrase === 2)) {
      harmonica(ctx, b, c.harm / 2, t, FOLK_BAR * FOLK_STEP);
    }

    /* 三度和声：句尾两小节，副歌感 */
    if (phrase >= 2 && local === 2) pluck(ctx, b, c.third * 2, t, 0.45);
    if (phrase >= 2 && local === 6) pluck(ctx, b, c.root * 2, t, 0.45);
  }
  function schedulePostStep(ctx, b, step, t) {
    var bar = Math.floor(step / POST_BAR) % POST_BARS;
    var local = step % POST_BAR;
    var chord = POST_CHORDS[Math.floor(bar / 2) % POST_CHORDS.length];
    var section = bar < 2 ? 0 : bar < 4 ? 1 : bar < 6 ? 2 : 3;   // 渐强的四层

    /* 垫只在低层铺；全奏段让位给吉他，改用一个高八度的小垫增加亮度而不是重量 */
    if (local === 0 && (bar === 0 || bar === 2)) postBed(ctx, b, chord, t, POST_BAR * POST_STEP * 2);
    if (local === 0 && bar === 6) postBed(ctx, b, [chord[0] * 2, chord[1] * 2, chord[2] * 2], t, POST_BAR * POST_STEP);

    /* 怪奇物语三层：脉冲从第一小节就走，长鸣在第二层进来，滴答只在后半段 */
    if (local % 2 === 0) stPulse(ctx, b, POST_ARP[((local / 2) + bar * 2) % POST_ARP.length] / 4, t, section >= 2 ? 1 : 0.62);
    if (local === 0 && (bar === 2 || bar === 4)) stDrone(ctx, b, chord[0], t, POST_BAR * POST_STEP * 2);
    if (section >= 2 && local % 4 === 2) stTick(ctx, b, t, section >= 3 ? 1 : 0.6);

    /* 干净的延迟琶音：从第一小节就在，是这条曲子的线索 */
    if (local % 2 === 0) postPluck(ctx, b, POST_ARP[((local / 2) + bar) % POST_ARP.length], t, 0.65);

    if (section >= 1) {
      if (local === 0 || local === 8) {
        postSub(ctx, b, chord[0] / 2, t, POST_STEP * 7, 0.5);
        kick(ctx, b, t);
      }
      if (local === 4 || local === 10) bell(ctx, b, POST_ARP[(bar + local) % POST_ARP.length] * 2, t);
    }

    if (section >= 2) {
      if (local === 4 || local === 12) snare(ctx, b, t);
      if (local % 4 === 0) hat(ctx, b, t, 1.8);
      /* 颤音吉他十六分不停 —— 后摇的"推进"就是它 */
      tremolo(ctx, b, POST_TREMS[(step * 3 + bar) % POST_TREMS.length], t, 0.30);
    }

    if (section >= 3) {
      if (local === 6 || local === 14) kick(ctx, b, t);
      tremolo(ctx, b, POST_TREMS[(step * 5 + bar + 2) % POST_TREMS.length], t, 1.0);
      if (local % 4 === 2) hat(ctx, b, t, 2.2);
      if (local === 0 || local === 8) stab(ctx, b, [chord[0] * 2, chord[1] * 2, chord[2] * 2], t);
    }

    if (bar === POST_BARS - 1 && local === 12) swell(ctx, b, t);   // 推回开头
    if (bar === 0 && local === 0) crash(ctx, b, t);                // 缝住 loop 接点
  }

  /* ======================= 音效 ======================= */
  function sfxError(ctx, b) {
    var t = ctx.currentTime + 0.01;
    [0, 0.16].forEach(function (off, i) {
      var o = ctx.createOscillator();
      o.type = "square";
      o.frequency.setValueAtTime(i === 0 ? 420 : 300, t + off);
      o.frequency.exponentialRampToValueAtTime(i === 0 ? 300 : 150, t + off + 0.15);

      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + off);
      g.gain.linearRampToValueAtTime(0.09, t + off + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.2);

      var f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 2200;

      o.connect(f); f.connect(g); g.connect(b.sfx);
      o.start(t + off); o.stop(t + off + 0.24);
    });

    var n = ctx.createBufferSource();
    n.buffer = b.noise;
    var nf = ctx.createBiquadFilter();
    nf.type = "lowpass";
    nf.frequency.value = 420;
    var ng = ctx.createGain();
    ng.gain.setValueAtTime(0.16, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    n.connect(nf); nf.connect(ng); ng.connect(b.sfx);
    n.start(t); n.stop(t + 0.34);
  }

  function sfxBlip(ctx, b) {
    var t = ctx.currentTime + 0.01;
    var o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(880, t);
    o.frequency.exponentialRampToValueAtTime(1480, t + 0.09);

    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.11, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);

    o.connect(g); g.connect(b.sfx);
    o.start(t); o.stop(t + 0.18);
  }

  function sfxTeapot(ctx, b) {
    var t = ctx.currentTime + 0.01;
    var o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(1560, t + 0.22);
    o.frequency.exponentialRampToValueAtTime(900, t + 0.6);

    var lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 11;
    var lfoGain = ctx.createGain();
    lfoGain.gain.value = 26;
    lfo.connect(lfoGain);
    lfoGain.connect(o.frequency);

    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.08, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.62);

    o.connect(g); g.connect(b.sfx);
    o.start(t); o.stop(t + 0.66);
    lfo.start(t); lfo.stop(t + 0.66);
  }

  var SFX = { error: sfxError, blip: sfxBlip, teapot: sfxTeapot };

  /* ======================= 歌词 ======================= */
  function lyricData() {
    return (typeof window !== "undefined" && window.ATTLYRICS) || null;
  }

  function flatLines() {
    var data = lyricData();
    if (!data) return [];
    var out = [];
    (data.sections || []).forEach(function (sec) {
      (sec.lines || []).forEach(function (text) {
        out.push({ text: text, label: sec.label, hook: !!sec.hook });
      });
    });
    return out;
  }

  /* ======================= 状态 ======================= */
  var state = {
    ctx: null,
    buses: null,
    timer: null,
    crackle: null,
    step: 0,
    next: 0,
    on: false,
    vol: parseFloat(store(STORE_VOL)) || 0.6,
    /* 本站播放器只放器乐背景音乐。说唱是独立的作品（music.html / Release），
       不参与这里的曲目切换，也不再用系统语音朗读任何东西。 */
    track: "postrock",              /* 背景音乐：The Long Send（后摇），不是 01 那条铺底 */
    /* 人声默认关闭：只用系统语音朗读的「人声」是很多人不想要的，
       所以它必须由用户显式打开。默认只放伴奏 + 页面上的逐句高亮。 */
    voice: store(STORE_VOICE) === "1",
    line: -1,
    utterId: 0,
    lineTimer: null,
    watchdog: null,
    ttsBroken: false
  };

  var lineSubs = [];

  function stepDur() {
    if (state.track === "rap") return RAP_STEP;
    if (state.track === "postrock") return POST_STEP;
    if (state.track === "folk") return FOLK_STEP;
    return STEP;
  }

  function scheduleStep(ctx, b, step, t) {
    if (state.track === "rap") scheduleRapStep(ctx, b, step, t);
    else if (state.track === "postrock") schedulePostStep(ctx, b, step, t);
    else if (state.track === "folk") scheduleFolkStep(ctx, b, step, t);
    else scheduleLofiStep(ctx, b, step, t);
  }

  /* ======================= 系统语音（Rap 人声） =======================
     明确优先「英语男声」。系统里的语音列表五花八门，所以按可信度分三档挑：
     先认名字里就写着男声/男性名人的英语语音，再退到任意英语语音（排除已知女声），
     最后才用其他语言。挑不到就按无人声处理（伴奏 + 歌词随拍推进）。 */
  var VOICE_MALE_HINTS = /(david|mark|guy|ryan|andrew|brian|christopher|eric|steffan|james|george|daniel|alex|fred|oliver|thomas|male)/i;
  var VOICE_FEMALE_HINTS = /(zira|aria|jenny|michelle|huihui|xiaoxiao|xiaoyi|yaoyao|samantha|victoria|karen|moira|tessa|fiona|susan|female|allison|ava|serena)/i;

  function voiceScore(v) {
    var name = (v.name || "") + " " + (v.voiceURI || "");
    var lang = v.lang || "";
    var score = 0;
    if (/^en/i.test(lang)) score += 40;                      // 英文优先（本站已是英文站）
    if (/^en[-_]?(us|gb)/i.test(lang)) score += 6;
    if (VOICE_MALE_HINTS.test(name)) score += 30;
    if (VOICE_FEMALE_HINTS.test(name)) score -= 45;
    if (/natural|neural|online/i.test(name)) score += 4;      // 新式自然音色通常更好听
    return score;
  }

  function zhVoice() {
    if (!("speechSynthesis" in window)) return null;
    var vs = window.speechSynthesis.getVoices() || [];
    if (!vs.length) return null;
    var best = null, bestScore = -Infinity;
    for (var i = 0; i < vs.length; i++) {
      var s = voiceScore(vs[i]);
      if (s > bestScore) { bestScore = s; best = vs[i]; }
    }
    // 分数太低说明这台机器上没有一个像样的英语男声，就别硬读
    return bestScore >= 40 ? best : null;
  }

  function ttsSupported() {
    return "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function";
  }

  function emitLine(index) {
    state.line = index;
    var lines = flatLines();
    var payload = (index < 0 || !lines[index])
      ? null
      : {
          index: index,
          text: lines[index].text,
          label: lines[index].label,
          hook: lines[index].hook,
          total: lines.length
        };
    lineSubs.forEach(function (fn) { try { fn(payload); } catch (e) { /* 订阅者自己的问题 */ } });
  }

  function startKaraokeTimer(fromIndex) {
    clearInterval(state.lineTimer);
    var lines = flatLines();
    if (!lines.length) return;
    var i = fromIndex >= 0 ? fromIndex : 0;
    emitLine(i % lines.length);
    var durMs = RAP_LINE_BARS * RAP_BAR * RAP_STEP * 1000;
    state.lineTimer = setInterval(function () {
      if (!state.on || state.track !== "rap") return;
      i = (i + 1) % flatLines().length;
      emitLine(i);
    }, durMs);
  }

  function speakLine(index) {
    if (!state.on || state.track !== "rap") return;
    var lines = flatLines();
    if (!lines.length) return;

    var idx = ((index % lines.length) + lines.length) % lines.length;
    var myId = ++state.utterId;

    var u = new SpeechSynthesisUtterance(lines[idx].text);
    var v = zhVoice();
    u.lang = v ? v.lang : "en-US";
    // 男声 + 说唱语感：语速略快、音高压低
    u.rate = 1.06;
    u.pitch = 0.78;
    u.volume = 1;
    if (v) u.voice = v;

    var started = false;
    u.onstart = function () {
      started = true;
      clearTimeout(state.watchdog);
      if (state.utterId === myId) emitLine(idx);
    };
    u.onend = function () {
      if (state.utterId !== myId || !state.on || state.track !== "rap") return;
      speakLine(idx + 1);
    };
    u.onerror = function () {
      if (state.utterId !== myId) return;
      state.ttsBroken = true;
      startKaraokeTimer(idx);
      syncUI();
    };

    try {
      window.speechSynthesis.cancel();   // 清掉上一条，避免排队堆积
      window.speechSynthesis.speak(u);
    } catch (e) {
      state.ttsBroken = true;
      startKaraokeTimer(idx);
      syncUI();
      return;
    }

    // 看守：1.6 秒内没有任何 onstart，就认定这台机器上没有可用的中文语音，
    // 自动降级成「伴奏 + 歌词随拍推进」，不让页面卡在一句重复上。
    clearTimeout(state.watchdog);
    state.watchdog = setTimeout(function () {
      if (started || !state.on || state.track !== "rap" || state.utterId !== myId) return;
      state.ttsBroken = true;
      try { window.speechSynthesis.cancel(); } catch (e) { /* 忽略 */ }
      startKaraokeTimer(idx);
      syncUI();
    }, 1600);
  }

  function stopSpeech() {
    clearTimeout(state.watchdog);
    clearInterval(state.lineTimer);
    state.lineTimer = null;
    state.utterId++;
    if (ttsSupported()) { try { window.speechSynthesis.cancel(); } catch (e) { /* 忽略 */ } }
    emitLine(-1);
  }

  /* ======================= 外部音轨（AI 生成的成品） =======================
     如果 assets/audio/rap.mp3 存在（由 tools/music-ai/generate.mjs 远程生成），
     就直接放这首成品歌，不再叠合成伴奏、也不用系统语音朗读。
     加载失败或格式不支持时，自动退回「合成伴奏 + 可选人声」的老路径。 */
  var EXTERNAL_TRACKS = { rap: "assets/audio/rap.mp3" };
  var external = { el: null, ok: false, ready: false, track: null, sync: null };

  function probeExternal(trackId) {
    var src = EXTERNAL_TRACKS[trackId];
    if (!src || typeof Audio !== "function") return;
    if (external.el && external.track === trackId) return;

    var el = new Audio();
    el.preload = "metadata";
    el.loop = false;
    el.addEventListener("loadedmetadata", function () {
      external.ok = true;
      external.ready = true;
      syncUI();
    });
    el.addEventListener("error", function () {
      external.ok = false;
      external.ready = true;
      syncUI();
    });
    el.src = src;
    external = { el: el, ok: false, ready: false, track: trackId, sync: null };
  }

  function startExternal() {
    var el = external.el;
    if (!el) return false;
    el.volume = Math.min(1, Math.max(0.0001, state.vol));
    el.currentTime = 0;

    // 逐句高亮跟着成品歌的时间轴走
    clearInterval(external.sync);
    external.sync = setInterval(function () {
      if (!el.duration) return;
      var all = flatLines();
      if (!all.length) return;
      var idx = Math.min(all.length - 1, Math.floor((el.currentTime / el.duration) * all.length));
      if (idx !== state.line) emitLine(idx);
    }, 250);

    el.onended = function () { stop(); };
    var p = el.play();
    if (p && typeof p.catch === "function") {
      p.catch(function () { fallbackToSynth(); });     // 被浏览器拦下就退回合成伴奏
    }
    return true;
  }

  function stopExternal() {
    clearInterval(external.sync);
    external.sync = null;
    if (external.el) {
      try { external.el.pause(); } catch (e) { /* 忽略 */ }
    }
  }

  function fallbackToSynth() {
    external.ok = false;
    var ctx = ensureCtx();
    if (!ctx) return;
    state.step = 0;
    state.next = ctx.currentTime + 0.08;
    clearInterval(state.timer);
    state.timer = setInterval(pump, 60);
    pump();
    if (state.voice && ttsSupported() && !state.ttsBroken) speakLine(0);
    else startKaraokeTimer(0);
    syncUI();
  }

  /* ======================= 播放引擎 ======================= */
  function ensureCtx() {
    if (state.ctx) return state.ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      state.ctx = new AC();
      state.buses = createBuses(state.ctx, state.ctx.destination);
    } catch (e) {
      state.ctx = null;
      return null;
    }
    return state.ctx;
  }

  function pump() {
    var ctx = state.ctx;
    if (!ctx) return;
    var dur = stepDur();
    while (state.next < ctx.currentTime + 0.2) {
      scheduleStep(ctx, state.buses, state.step, state.next);
      state.next += dur;
      state.step++;
    }
  }

  function targetGain() {
    return state.on ? state.vol * 0.3 : 0.0001;
  }

  function rampMaster(seconds) {
    if (!state.buses) return;
    var g = state.buses.master.gain;
    var now = state.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(g.value, 0.0001), now);
    g.exponentialRampToValueAtTime(Math.max(targetGain(), 0.0001), now + seconds);
  }

  function start() {
    // 静音标记（?sound=off 或界面上的 ✕）优先于一切：连 AudioContext 都不创建
    if (hardMuted || isMuted()) {
      hardMuted = true;
      syncUI();
      return false;
    }
    var ctx = ensureCtx();
    if (!ctx) return false;
    if (ctx.state === "suspended") ctx.resume();

    if (!state.on) {
      state.on = true;
      claim();          // 宣布「这一页在放」，其他标签页收到后会让位
      rampMaster(0.9);

      if (state.track === "rap" && external.ok) {
        // 有 AI 生成的成品歌：直接放它，不叠合成伴奏、不用系统语音
        startExternal();
      } else {
        state.step = 0;
        state.next = ctx.currentTime + 0.08;
        clearInterval(state.timer);
        state.timer = setInterval(pump, 60);
        pump();

        if (state.track === "rap") {
          try { state.crackle = crackle(ctx, state.buses); } catch (e) { state.crackle = null; }
          if (state.voice && ttsSupported() && !state.ttsBroken) speakLine(state.line >= 0 ? state.line : 0);
          else startKaraokeTimer(0);
        }
      }
    }
    store(STORE_ON, "1");
    syncUI();
    return true;
  }

  function stop() {
    state.on = false;
    store(STORE_ON, "0");
    rampMaster(0.45);
    clearInterval(state.timer);
    state.timer = null;
    stopExternal();
    if (state.crackle) {
      try { state.crackle.stop(); } catch (e) { /* 忽略 */ }
      state.crackle = null;
    }
    stopSpeech();
    releaseClaim();
    syncUI();
  }

  function toggle() {
    if (state.on) { stop(); return false; }
    return start();
  }

  function setVolume(v) {
    state.vol = Math.max(0, Math.min(1, v));
    store(STORE_VOL, String(state.vol));
    if (external.el) external.el.volume = Math.min(1, Math.max(0.0001, state.vol));
    if (state.on) rampMaster(0.2);
    syncUI();
  }

  function selectTrack(id) {
    if (id !== "rap" && id !== "postrock" && id !== "folk") id = "lofi";
    if (id === state.track) return state.track;
    var wasOn = state.on;
    if (wasOn) stop();
    state.track = id;
    state.ttsBroken = false;
    state.line = -1;
    store(STORE_TRACK, id);
    if (wasOn) start(); else syncUI();
    return state.track;
  }

  /* 本站只有器乐一条曲目；说唱是独立作品，不在这里切换。 */
  function nextTrack() {
    return state.track;
  }

  function isOn() { return state.on; }

  function currentTrack() {
    var data = lyricData();
    return {
      id: state.track,
      name: state.track === "rap"
        ? ((data && data.title) || "Attachment Too Large") + " (Rap)"
        : state.track === "postrock" ? "The Long Send" : state.track === "folk" ? "The Twenty-Megabyte Line" : "Failed at 19:59",
      kind: state.track
    };
  }

  function play(name) {
    if (!state.on) return false;          // 音效跟随音乐开关，避免突然出声
    var ctx = ensureCtx();
    if (!ctx || !SFX[name]) return false;
    if (ctx.state === "suspended") ctx.resume();
    SFX[name](ctx, state.buses);
    return true;
  }

  function onLine(fn) {
    if (typeof fn !== "function") return function () {};
    lineSubs.push(fn);
    var lines = flatLines();
    if (state.line >= 0 && lines[state.line]) {
      fn({ index: state.line, text: lines[state.line].text, label: lines[state.line].label, hook: lines[state.line].hook, total: lines.length });
    }
    return function () {
      var i = lineSubs.indexOf(fn);
      if (i >= 0) lineSubs.splice(i, 1);
    };
  }

  /* 从指定的一行开始表演（歌词页点任意一行即可跳过去） */
  function playFrom(index) {
    var lines = flatLines();
    if (!lines.length) return -1;
    var i = ((index % lines.length) + lines.length) % lines.length;
    state.line = i;
    if (state.track !== "rap") selectTrack("rap");
    if (!state.on) {
      ensureCtx();
      start();
    } else if (state.voice && ttsSupported() && !state.ttsBroken) {
      speakLine(i);
    } else {
      startKaraokeTimer(i);
    }
    return i;
  }

  /* 人声开关：默认关。打开后才用系统语音朗读歌词。 */
  function setVoice(on) {
    state.voice = !!on;
    store(STORE_VOICE, on ? "1" : "0");
    if (state.on && state.track === "rap") {
      if (state.voice) {
        clearInterval(state.lineTimer);
        state.lineTimer = null;
        if (ttsSupported() && !state.ttsBroken) speakLine(state.line >= 0 ? state.line : 0);
      } else {
        stopSpeech();                       // 立刻停止朗读，但保留伴奏
        startKaraokeTimer(state.line >= 0 ? state.line : 0);
      }
    }
    syncUI();
  }

  /* ======================= 离线渲染（自检用） ======================= */
  function renderOffline(seconds, track) {
    var OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OC) return Promise.reject(new Error("no OfflineAudioContext"));
    var which = track || state.track;
    var sr = 44100;
    var ctx = new OC(2, Math.ceil(sr * seconds), sr);
    var buses = createBuses(ctx, ctx.destination);
    buses.master.gain.value = 0.3;

    var dur = which === "rap" ? RAP_STEP : which === "postrock" ? POST_STEP : STEP;
    var steps = Math.ceil(seconds / dur);
    for (var i = 0; i < steps; i++) {
      if (which === "rap") scheduleRapStep(ctx, buses, i, i * dur);
      else if (which === "postrock") schedulePostStep(ctx, buses, i, i * dur);
      else scheduleLofiStep(ctx, buses, i % TOTAL_STEPS, i * dur);
    }
    if (which === "rap") { try { crackle(ctx, buses); } catch (e) { /* 忽略 */ } }

    return ctx.startRendering().then(function (buf) {
      var ch = buf.getChannelData(0);
      var peak = 0, sum = 0;
      var prev = 0, sumDiff = 0;
      var mid = Math.floor(ch.length / 2), sumA = 0, sumB = 0;
      for (var j = 0; j < ch.length; j++) {
        var a = Math.abs(ch[j]);
        if (a > peak) peak = a;
        sum += ch[j] * ch[j];
        var d = ch[j] - prev;            // 相邻样本差：噪声与嘶声会让它飙高
        sumDiff += d * d;
        prev = ch[j];
        if (j < mid) sumA += ch[j] * ch[j]; else sumB += ch[j] * ch[j];
      }
      var rmsA = Math.sqrt(sumA / mid), rmsB = Math.sqrt(sumB / (ch.length - mid));
      /* 起音密度：先取 5 ms 跳距的能量包络，再在包络上找上升沿。
         直接在波形上设阈值会数到振荡周期本身（4 个周期就是 4 个「起音」），
         那不是节奏 —— 所以必须先算包络，再和它自己的滑动均值比较。 */
      var hop = Math.max(1, Math.round(sr * 0.005));
      var env = [];
      for (var h = 0; h + hop <= ch.length; h += hop) {
        var e = 0;
        for (var m = 0; m < hop; m++) { var v2 = ch[h + m]; e += v2 * v2; }
        env.push(Math.sqrt(e / hop));
      }
      var onsets = 0, lastOnset = -1e9, refr = Math.round(0.08 / 0.005);   // 80 ms 不应期
      for (var q = 1; q < env.length; q++) {
        var from = Math.max(0, q - 40), acc = 0, cnt = 0;
        for (var p = from; p < q; p++) { acc += env[p]; cnt++; }
        var avg = cnt ? acc / cnt : 0;
        if (env[q] > 0.02 && avg > 0 && env[q] > avg * 2.2 && (q - lastOnset) > refr) {
          onsets++;
          lastOnset = q;
        }
      }
      /* ------------------------------------------------------------------
         频谱分析：这才是「两首曲子像不像」该看的东西。取若干窗做 FFT，
         求频谱质心与低/中/高频段的能量占比 —— 一个曲子换了骨架（和声垫、
         低音、琶音全部不同）必然体现在这里，而打击乐只是在同一骨架上加层，
         频谱质心几乎不动。
         ------------------------------------------------------------------ */
      var N = 2048;
      var spec = (function () {
        var re = new Float64Array(N), im = new Float64Array(N);
        var cosT = new Float64Array(N / 2), sinT = new Float64Array(N / 2);
        for (var k = 0; k < N / 2; k++) {
          cosT[k] = Math.cos(-2 * Math.PI * k / N);
          sinT[k] = Math.sin(-2 * Math.PI * k / N);
        }
        var acc = new Float64Array(N / 2), frames = 0;
        var step = Math.floor((ch.length - N) / 8) || 1;
        for (var off = 0; off + N < ch.length; off += step) {
          for (var i2 = 0; i2 < N; i2++) {
            var w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i2 / (N - 1));   // Hann
            re[i2] = ch[off + i2] * w;
            im[i2] = 0;
          }
          /* 直接 DFT。这里以前是一版手写的迭代 radix-2 FFT，它有 bug：440 Hz 的
             正弦会被读成 7.8 kHz，能量被抹到整个频谱上，于是频谱质心永远是
             9–11 kHz —— 我曾拿这个坏数字当作"两首曲子很像"的证据，那是错的。
             直接算慢一些，但正确：量具错了比没有量具更糟。 */
          var binHz0 = ctx.sampleRate / N;
          var kTop = Math.min(N / 2, Math.ceil(9000 / binHz0));       // 9 kHz 以上不再逐 bin 统计
          for (var k3 = 1; k3 < kTop; k3++) {
            var sr2 = 0, si2 = 0, th0 = 2 * Math.PI * k3 / N;
            for (var i3 = 0; i3 < N; i3++) {
              sr2 += re[i3] * Math.cos(th0 * i3);
              si2 += re[i3] * Math.sin(th0 * i3);
            }
            acc[k3] += sr2 * sr2 + si2 * si2;
          }
          frames++;
        }
        if (!frames) return null;
        var sr = ctx.sampleRate, binHz = sr / N;
        var total = 0, weighted = 0, low = 0, mid = 0, high = 0;
        for (var k4 = 1; k4 < N / 2; k4++) {
          var power = acc[k4] / frames, f = k4 * binHz;
          total += power; weighted += power * f;
          if (f < 300) low += power; else if (f < 2000) mid += power; else high += power;
        }
        if (!total) return null;
        return {
          centroidHz: Math.round(weighted / total),
          lowShare: Math.round((low / total) * 1000) / 1000,
          midShare: Math.round((mid / total) * 1000) / 1000,
          highShare: Math.round((high / total) * 1000) / 1000
        };
      })();

      return {
        track: which,
        seconds: seconds,
        steps: steps,
        peak: Math.round(peak * 10000) / 10000,
        rms: Math.round(Math.sqrt(sum / ch.length) * 10000) / 10000,
        /* 高频能量占比（用一阶差分当粗略高通）：纯音色的器乐应当很低，
           噪声踩镲一类的「杂音」会把它明显推上去。 */
        hf: Math.round((sumDiff / Math.max(sum, 1e-9)) * 10000) / 10000,
        /* 前后半段各自的音量：用来验证「可以一直循环」——
           如果两段差得离谱，说明循环边界塌了或声音在衰减。 */
        rmsFirstHalf: Math.round(rmsA * 10000) / 10000,
        rmsSecondHalf: Math.round(rmsB * 10000) / 10000,
        onsetsPerSecond: Math.round((onsets / seconds) * 100) / 100,
        centroidHz: spec ? spec.centroidHz : 0,
        lowShare: spec ? spec.lowShare : 0,
        midShare: spec ? spec.midShare : 0,
        highShare: spec ? spec.highShare : 0,
        loopSeconds: Math.round((which === "rap" ? RAP_BAR * RAP_STEP * 4 : LOOP_SECONDS) * 100) / 100
      };
    });
  }

  /* ======================= 界面（自注入） ======================= */
  var ICON_PLAY = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.2v13.6L19 12z"/></svg>';
  var ICON_PAUSE = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.8h3.6v14.4H7zM13.4 4.8H17v14.4h-3.6z"/></svg>';

  var ui = null;

  function buildUI() {
    if (document.querySelector("[data-music]")) return;

    var root = document.createElement("div");
    root.className = "music-pill";
    root.setAttribute("data-music", "");
    root.innerHTML =
      '<button class="music-btn" type="button" data-music-toggle aria-pressed="false">' + ICON_PLAY + '</button>' +
      '<span class="music-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>' +
      '<span class="music-meta">' +
        '<span class="music-title" data-music-title>The Long Send</span>' +
        '<span class="music-sub" data-music-status>Title track · synthesized live</span>' +
      '</span>' +
      '<a class="music-chip" href="music.html" data-music-lyrics title="All four recordings, with lyrics">Recordings ↗</a>' +
      '<button class="music-chip" type="button" data-music-mute title="Mute everything and keep it muted">✕</button>' +
      '<input class="music-vol" type="range" min="0" max="100" value="' + Math.round(state.vol * 100) +
        '" aria-label="Volume" data-music-vol>';

    document.body.appendChild(root);
    ui = root;

    root.querySelector("[data-music-toggle]").addEventListener("click", function () {
      if (hardMuted) { setMuted(false); start(); return; }   // 静音状态下点播放 = 解除静音并播放
      toggle();
    });
    root.querySelector("[data-music-mute]").addEventListener("click", function () {
      var nowMuted = !hardMuted;
      setMuted(nowMuted);
    });
    root.querySelector("[data-music-vol]").addEventListener("input", function (e) {
      setVolume(parseInt(e.target.value, 10) / 100);
    });

    // 有些浏览器语音列表是异步就绪的，就绪后刷新一下状态文案
    if (ttsSupported() && typeof window.speechSynthesis.addEventListener === "function") {
      window.speechSynthesis.addEventListener("voiceschanged", function () { syncUI(); });
    }

    syncUI();
  }

  function syncUI() {
    if (!ui) return;
    var btn = ui.querySelector("[data-music-toggle]");
    var status = ui.querySelector("[data-music-status]");
    var title = ui.querySelector("[data-music-title]");
    var trackBtn = ui.querySelector("[data-music-track]");

    ui.classList.toggle("is-playing", state.on);
    ui.classList.toggle("is-rap", state.track === "rap");
    ui.classList.toggle("is-muted", hardMuted);

    btn.innerHTML = state.on ? ICON_PAUSE : ICON_PLAY;
    btn.setAttribute("aria-pressed", state.on ? "true" : "false");
    btn.setAttribute("aria-label", hardMuted ? "Sound is off — click to enable" : (state.on ? "Pause" : "Play"));
    btn.setAttribute("title", hardMuted ? "Sound off. Click to enable." : (state.on ? "Pause" : "Play (sound effects follow this switch)"));

    var muteBtn = ui.querySelector("[data-music-mute]");
    if (muteBtn) {
      muteBtn.textContent = hardMuted ? "♪" : "✕";
      muteBtn.setAttribute("title", hardMuted ? "Sound is off. Click to allow sound again." : "Mute everything (stays muted after reload)");
      muteBtn.setAttribute("aria-pressed", hardMuted ? "true" : "false");
    }

    var voiceBtn = ui.querySelector("[data-music-voice]");
    if (voiceBtn) {
      voiceBtn.textContent = state.voice ? "Voice on" : "Voice off";
      voiceBtn.classList.toggle("is-on", state.voice);
      voiceBtn.setAttribute("title", state.voice
        ? "System voice is reading the lyrics. Click to turn it off."
        : "System voice is off — only the beat plays. Click to let it read the lyrics.");
      voiceBtn.setAttribute("aria-pressed", state.voice ? "true" : "false");
    }

    var t = currentTrack();
    if (title) title.textContent = t.name;
    if (trackBtn) {
      trackBtn.textContent = state.track === "rap" ? "Rap" : "Lo-fi";
      trackBtn.setAttribute("title", state.track === "rap" ? "Back to the lo-fi track" : "Switch to the rap track");
    }

    if (status) {
      if (hardMuted) {
        status.textContent = "Sound off · click ♪ to allow it again";
      } else if (state.track === "rap" && external.ok) {
        status.textContent = state.on ? "AI track playing (ACE-Step) · 2:50" : "AI track · generated by ACE-Step";
      } else if (state.track === "lofi") {
        status.textContent = state.on ? "Volume " + Math.round(state.vol * 100) + "% · SFX on" : "Title track · synthesized live";
      } else if (!state.voice) {
        status.textContent = state.on ? "Beat only · voice is off (no narration)" : "Rap · voice off by default";
      } else if (!ttsSupported() || state.ttsBroken) {
        status.textContent = state.on ? "Beat + lyrics on the bar (no matching voice here)" : "Rap · spoken by your system voice";
      } else {
        var vn = zhVoice();
        status.textContent = state.on
          ? "Spoken by " + (vn ? vn.name.split(" - ")[0] : "system voice") + " · beat synthesized"
          : "Rap · spoken by your system voice";
      }
    }

    var vol = ui.querySelector("[data-music-vol]");
    if (vol) vol.value = String(Math.round(state.vol * 100));
  }

  /* ======================= 对外接口 ======================= */
  window.ATTMusic = {
    start: start,
    stop: stop,
    toggle: toggle,
    isOn: isOn,
    setVolume: setVolume,
    play: play,
    selectTrack: selectTrack,
    nextTrack: nextTrack,
    currentTrack: currentTrack,
    onLine: onLine,
    playFrom: playFrom,
    lyrics: flatLines,
    lyricData: lyricData,
    ttsSupported: ttsSupported,
    ttsBroken: function () { return state.ttsBroken; },
    renderOffline: renderOffline,
    loopSeconds: function () { return LOOP_SECONDS; },
    state: function () {
      return { track: state.track, on: state.on, vol: state.vol, line: state.line, ttsBroken: state.ttsBroken, muted: hardMuted };
    },
    mute: setMuted,
    isMuted: function () { return hardMuted; },
    setVoice: setVoice,
    voiceOn: function () { return state.voice; },
    usingExternal: function () { return state.track === "rap" && external.ok; },
    externalReady: function () { return external.ready; },
    externalState: function () {
      return {
        ready: external.ready,
        ok: external.ok,
        paused: external.el ? external.el.paused : null,
        time: external.el ? Math.round(external.el.currentTime * 10) / 10 : null,
        duration: external.el && isFinite(external.el.duration) ? Math.round(external.el.duration) : null
      };
    },
    panic: function () { setMuted(true); }        // 一键全停并保持静音
  };

  window.attSfx = function (name) {
    try { return play(name); } catch (e) { return false; }
  };

  function boot() {
    if (!(window.AudioContext || window.webkitAudioContext)) return;  // 不支持就完全不显示
    hardMuted = isMuted();
    setupChannel();
    // 说唱不参与本站播放器：成品只在 music.html 里由原生播放器播放
    buildUI();

    // 离开、隐藏或关闭页面时彻底收声：
    // 后台标签页里一直有人念歌词，是用户最容易「找不到声音从哪来」的情形。
    window.addEventListener("pagehide", function () { if (state.on) stop(); releaseClaim(); });
    window.addEventListener("beforeunload", function () { if (state.on) stop(); releaseClaim(); });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && state.on) stop();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
