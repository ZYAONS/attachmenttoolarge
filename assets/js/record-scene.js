/* ==========================================================================
   record-scene.js — the record screen, modelled and rendered

   Not a drawing of the photograph: geometry that is actually lit. The platter
   is a cylinder, the segmented cards are extruded arcs, the grooves are rings
   that catch the light, the crystal is a faceted gem with transmission, and the
   pale form is a noisy sphere. Studio lighting throws one soft shadow.

   Three.js r147 is vendored next to this file: the site runs from file:// and
   from Pages, so nothing may be fetched from a CDN at runtime, and an ES module
   import would be blocked by CORS on file://. A classic script avoids both.

   If WebGL is missing the script leaves the drawn fallback (record-screen.svg)
   in place, so the page still shows the screen.
   ========================================================================== */
(function () {
  "use strict";
  var host = document.querySelector("[data-record-scene]");
  if (!host) return;
  var canvas = host.querySelector("canvas");
  var fallback = host.querySelector(".ms-fallback");
  if (!canvas || !window.THREE) return;          // fallback stays visible

  var gl = null;
  try { gl = canvas.getContext("webgl2") || canvas.getContext("webgl"); } catch (e) { gl = null; }
  if (!gl) return;                                // fallback stays visible

  var DEG = Math.PI / 180;
  var LIME = 0xc6e04a;
  var BACKDROP = 0x0a0c0b;        // 暗场：参考图是暗底，物体自己发光

  /* ---------------- renderer ---------------- */
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(BACKDROP, 1);

  var scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKDROP);

  var camera = new THREE.PerspectiveCamera(26, 3 / 2, 0.1, 400);
  /* the platter is 20 units across, so the camera has to stand far enough back that
     the whole object and the marks around it fit: ~30 units of visible height. */
  camera.position.set(0, 62, 20);
  camera.lookAt(0, 1.2, 0);

  /* ---------------- a small procedural environment, so glass has something to bend ---- */
  (function environment() {
    var c = document.createElement("canvas");
    c.width = 256; c.height = 128;
    var g = c.getContext("2d");
    var grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, "#39433f");
    grad.addColorStop(0.45, "#1d2426");
    grad.addColorStop(0.55, "#12181a");
    grad.addColorStop(1, "#07090a");
    g.fillStyle = grad; g.fillRect(0, 0, 256, 128);
    g.fillStyle = "rgba(220,255,200,0.55)";
    g.beginPath(); g.ellipse(70, 34, 46, 22, 0, 0, Math.PI * 2); g.fill();
    var tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.encoding = THREE.sRGBEncoding;
    scene.environment = tex;
  })();

  /* ---------------- lighting: a studio, not a lamp ---------------- */
  scene.add(new THREE.HemisphereLight(0xcfe8d8, 0x0a0f0e, 0.30));

  var key = new THREE.DirectionalLight(0xffffff, 0.95);
  key.position.set(-9, 16, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 6;
  key.shadow.bias = -0.0006;
  var sc = key.shadow.camera;
  sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 1; sc.far = 140;
  scene.add(key);

  var fill = new THREE.DirectionalLight(0xdfe8ff, 0.22);
  fill.position.set(10, 9, -7);
  scene.add(fill);

  var rim = new THREE.PointLight(0xeaffa0, 0.9, 22, 2);
  rim.position.set(0.6, 6.4, 0.4);
  scene.add(rim);

  /* ---------------- floor ---------------- */
  var floor = new THREE.Mesh(
    new THREE.PlaneGeometry(320, 320),
    new THREE.MeshStandardMaterial({ color: 0x121614, roughness: 0.95, metalness: 0.05 })
  );
  floor.rotation.x = -90 * DEG;
  floor.receiveShadow = true;
  scene.add(floor);

  /* ---------------- materials ---------------- */
  var matDisc   = new THREE.MeshStandardMaterial({ color: 0x0b0b0e, roughness: 0.78, metalness: 0.10, envMapIntensity: 0.35 });
  var matCardA  = new THREE.MeshStandardMaterial({ color: 0x09090c, roughness: 0.70, metalness: 0.14, envMapIntensity: 0.3 });
  var matCardB  = new THREE.MeshStandardMaterial({ color: 0x1a1a1f, roughness: 0.62, metalness: 0.18, envMapIntensity: 0.35 });
  var matCardC  = new THREE.MeshStandardMaterial({ color: 0x0b0b0e, roughness: 0.68, metalness: 0.14 });
  var matPale   = new THREE.MeshStandardMaterial({ color: 0xbfbfbb, roughness: 0.9, metalness: 0.02 });
  var matWhite  = new THREE.MeshStandardMaterial({ color: 0xdcdcd8, roughness: 0.92, metalness: 0 });
  var matGroove = new THREE.MeshStandardMaterial({ color: 0x35353b, roughness: 0.35, metalness: 0.5, envMapIntensity: 0.6 });
  var matLine   = new THREE.MeshStandardMaterial({ color: 0x121216, roughness: 0.6, metalness: 0.2 });
  var matLime   = new THREE.MeshStandardMaterial({ color: LIME, roughness: 0.42, metalness: 0.05, emissive: 0x2a3a06, emissiveIntensity: 0.35 });
  var matSalmon = new THREE.MeshStandardMaterial({ color: 0xeda189, roughness: 0.8, metalness: 0 });
  var matPlate  = new THREE.MeshStandardMaterial({ color: 0x3a3a3e, roughness: 0.6, metalness: 0.25 });
  var matHole   = new THREE.MeshStandardMaterial({ color: 0x131317, roughness: 0.5, metalness: 0.3 });
  var matCrystal = new THREE.MeshPhysicalMaterial({
    color: LIME, roughness: 0.06, metalness: 0, transmission: 0.82, thickness: 2.2,
    ior: 1.72, clearcoat: 0.7, clearcoatRoughness: 0.06, envMapIntensity: 1.5
  });

  var platter = new THREE.Group();
  scene.add(platter);

  var R = 10, TOP = 0.18;                        // radius, half thickness of the disc

  /* the disc itself */
  var disc = new THREE.Mesh(new THREE.CylinderGeometry(R, R, TOP * 2, 128), matDisc);
  disc.position.y = 0;
  disc.castShadow = true; disc.receiveShadow = true;
  platter.add(disc);

  /* concentric grooves: real rings that catch the key light. They live in the gaps
     between the card bands and inside the innermost one, which is where a record's
     cut actually shows on a platter like this. */
  var ringGeo = new THREE.TorusGeometry(1, 0.014, 6, 160);
  var grooveRadii = [];
  (function () {
    var r;
    for (r = 2.6; r < 5.25; r += 0.17) grooveRadii.push(r);      // inside the innermost card band
    for (r = 6.72; r < 6.95; r += 0.16) grooveRadii.push(r);     // between C and B
    for (r = 8.28; r < 8.5; r += 0.16) grooveRadii.push(r);      // between B and A
    for (r = 9.72; r < 9.94; r += 0.16) grooveRadii.push(r);     // out to the rim
  })();
  grooveRadii.forEach(function (rr) {
    var ring = new THREE.Mesh(ringGeo, matGroove);
    ring.scale.set(rr, rr, 1);
    ring.rotation.x = 90 * DEG;
    ring.position.y = TOP + 0.004;
    platter.add(ring);
  });

  /* an extruded arc: the cards that make up the platter's face */
  function arcCard(a0, a1, rMid, width, mat, y) {
    var shape = new THREE.Shape();
    shape.absarc(0, 0, rMid + width / 2, a0 * DEG, a1 * DEG, false);
    shape.absarc(0, 0, rMid - width / 2, a1 * DEG, a0 * DEG, true);
    var geo = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: false, curveSegments: 64 });
    var m = new THREE.Mesh(geo, mat);
    m.rotation.x = 90 * DEG;
    m.position.y = y;
    m.castShadow = true; m.receiveShadow = true;
    platter.add(m);
    return m;
  }

  /* card layout: three bands, with gaps, a couple of pale ones, as in the reference */
  var bands = [
    { r: 9.05, w: 1.15, y: TOP + 0.02, mat: matCardB, runs: [[8, 96], [104, 168], [176, 262], [270, 352]] },
    { r: 7.55, w: 1.35, y: TOP + 0.03, mat: matCardC, runs: [[14, 120], [132, 214], [226, 300], [312, 366]] },
    { r: 6.05, w: 1.15, y: TOP + 0.04, mat: matCardA, runs: [[0, 74], [86, 190], [202, 286], [298, 344]] }
  ];
  bands.forEach(function (b) {
    b.runs.forEach(function (run) { arcCard(run[0], run[1], b.r, b.w, b.mat, b.y); });
  });
  arcCard(20, 74, 9.05, 1.15, matPale, TOP + 0.021);
  arcCard(196, 244, 7.55, 1.35, matPale, TOP + 0.031);

  /* the pale wedge with its radial lines (lower left) */
  (function wedge() {
    var a0 = 196, a1 = 250;
    var shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.absarc(0, 0, 9.4, a0 * DEG, a1 * DEG, false);
    shape.lineTo(0, 0);
    var geo = new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: false, curveSegments: 64 });
    var m = new THREE.Mesh(geo, matWhite);
    m.rotation.x = 90 * DEG; m.position.y = TOP + 0.012;
    m.receiveShadow = true;
    platter.add(m);
    for (var i = 0; i < 12; i++) {
      var a = (a0 + 2 + i * (a1 - a0 - 4) / 11) * DEG;
      var len = 8.4, bar = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, len), matLine);
      bar.position.set(Math.cos(a) * (len / 2 + 0.7), TOP + 0.16, -Math.sin(a) * (len / 2 + 0.7));
      bar.rotation.y = a;
      platter.add(bar);
    }
  })();

  /* lime chevrons inside the wedge */
  for (var ci = 0; ci < 7; ci++) {
    var row = ci < 4 ? 0 : 1, col = ci < 4 ? ci : ci - 4;
    var ca = (206 + col * 9 + row * 4.5) * DEG;
    var cr = 5.2 - row * 1.35;
    var tri = new THREE.Shape();
    tri.moveTo(0.62, 0); tri.lineTo(-0.34, 0.42); tri.lineTo(-0.34, -0.42); tri.lineTo(0.62, 0);
    var chip = new THREE.Mesh(new THREE.ExtrudeGeometry(tri, { depth: 0.1, bevelEnabled: false }), matLime);
    chip.rotation.x = 90 * DEG;
    chip.rotation.z = -ca;
    chip.position.set(Math.cos(ca) * cr, TOP + 0.2, -Math.sin(ca) * cr);
    platter.add(chip);
  }

  /* white square outlines in the lower area */
  var squareSpots = [[-3.1, 4.4], [-2.2, 5.3], [-1.2, 4.6], [-0.2, 5.6], [-4.0, 5.6], [-2.7, 6.4], [-1.6, 6.9]];
  squareSpots.forEach(function (s, i) {
    var side = 0.62, t = 0.075, sq = new THREE.Group();
    [[0, side / 2, side, t], [0, -side / 2, side, t], [-side / 2, 0, t, side], [side / 2, 0, t, side]].forEach(function (b) {
      var bar = new THREE.Mesh(new THREE.BoxGeometry(b[2], 0.07, b[3]), matWhite);
      bar.position.set(b[0], 0, b[1]);
      sq.add(bar);
    });
    sq.position.set(s[0], TOP + 0.17 + i * 0.002, s[1]);
    platter.add(sq);
  });

  /* the dark plate behind the object, the salmon strip, the pale form, the spindle */
  var plate = new THREE.Mesh(new THREE.CylinderGeometry(4.35, 4.35, 0.55, 96), matPlate);
  plate.position.set(0, TOP + 0.28, 0.55);
  plate.castShadow = true; plate.receiveShadow = true;
  platter.add(plate);

  var strip = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 2.35), matSalmon);
  strip.position.set(-4.75, TOP + 0.42, 0.1);
  strip.rotation.y = 0.06;
  strip.castShadow = true;
  platter.add(strip);

  var blobGeo = new THREE.IcosahedronGeometry(1.78, 4);
  (function crumple() {
    var pos = blobGeo.attributes.position;
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      var n = Math.sin(x * 3.1 + y * 2.3) * Math.cos(z * 2.7 - y * 1.9) * 0.11
            + Math.sin(x * 6.2 - z * 4.1) * 0.05;
      var len = Math.sqrt(x * x + y * y + z * z) || 1;
      pos.setXYZ(i, x + (x / len) * n, y + (y / len) * n * 0.7, z + (z / len) * n);
    }
    pos.needsUpdate = true;
    blobGeo.computeVertexNormals();
  })();
  var blob = new THREE.Mesh(blobGeo, matWhite);
  blob.scale.set(1.42, 0.82, 1.18);
  blob.position.set(0.1, TOP + 1.0, 0.95);
  blob.castShadow = true; blob.receiveShadow = true;
  platter.add(blob);

  var spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.9, 32), matHole);
  spindle.position.set(0, TOP + 0.95, 0.35);
  platter.add(spindle);

  /* the crystal: a faceted gem, glassy rather than painted */
  var gem = new THREE.Group();
  var body = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.42, 2.1, 6, 1), matCrystal);
  body.position.y = 1.05;
  var tip = new THREE.Mesh(new THREE.ConeGeometry(0.92, 2.3, 6), matCrystal);
  tip.position.y = 3.25;
  var collar = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 0.34, 6), matCrystal);
  collar.position.y = -0.12;
  gem.add(body); gem.add(tip); gem.add(collar);
  gem.position.set(0, TOP + 0.75, 0.35);
  gem.rotation.y = 12 * DEG;
  gem.children.forEach(function (c) { c.castShadow = true; });
  platter.add(gem);

  /* the recorded groove edge highlight, standing slightly proud of the rim */
  var rimRing = new THREE.Mesh(new THREE.TorusGeometry(R - 0.12, 0.05, 8, 200), matGroove);
  rimRing.rotation.x = 90 * DEG;
  rimRing.position.y = TOP + 0.01;
  platter.add(rimRing);

  /* ---------------- the lime plus marks, standing on the floor ---------------- */
  function plus(x, z, s) {
    var g = new THREE.Group();
    var arm = 0.34 * s, th = 0.17 * s;
    [[0, 0, arm, th, th], [0, 0, th, th, arm]].forEach(function (b, i) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(b[2], 0.16 * s, b[3]), matLime);
      g.add(m);
    });
    g.position.set(x, 0.08 * s, z);
    scene.add(g);
    return g;
  }
  plus(-9.5, 6.2, 1.15);
  plus(11.4, -3.4, 1.0);
  plus(-11.2, -5.6, 0.85);

  /* ---------------- draw ---------------- */
  function resize() {
    var w = host.clientWidth || 1200;
    var h = Math.round(w * 2 / 3);
    canvas.width = Math.round(w * renderer.getPixelRatio());
    canvas.height = Math.round(h * renderer.getPixelRatio());
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }

  /* a few frames, so shadows and the environment settle, then hold still:
     the reference is a still screen and this is not the place to invent motion */
  var frames = 0;
  function warm() {
    renderer.render(scene, camera);
    if (++frames < 8) requestAnimationFrame(warm);
  }

  host.classList.add("is-rendered");
  if (fallback) fallback.setAttribute("aria-hidden", "true");
  resize();
  warm();
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", resize);
})();
