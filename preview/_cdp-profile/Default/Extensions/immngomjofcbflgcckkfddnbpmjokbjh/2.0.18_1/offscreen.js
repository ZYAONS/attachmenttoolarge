/******/ (() => { // webpackBootstrap
/******/ 	"use strict";

;// ./src/popup/types/chrome/index.tsx
var Sender;
(function (Sender) {
    Sender[Sender["React"] = 0] = "React";
    Sender[Sender["Content"] = 1] = "Content";
    Sender[Sender["Offscreen"] = 2] = "Offscreen";
    Sender[Sender["Background"] = 3] = "Background";
})(Sender || (Sender = {}));

;// ./src/background/offscreen.ts

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.to !== Sender.Offscreen) {
        return;
    }
    switch (msg.type) {
        case "check_internet":
            try {
                const myWorker = new Worker("./web_worker.js");
                myWorker.onerror = (err) => {
                    console.error("[offscreen] worker error:", err.message, err);
                };
                myWorker.postMessage(["check_internet_worker", msg.url, msg.attemptId]);
                myWorker.onmessage = async (e) => {
                    if (e.data[0] === "check_internet_result_worker") {
                        const ip_result = e.data[1];
                        const attemptId = e.data[2];
                        try {
                            await chrome.runtime.sendMessage({
                                from: Sender.Offscreen,
                                to: Sender.Background,
                                type: "check_internet_result",
                                ip_result,
                                attemptId,
                                data: msg.data,
                            });
                        }
                        catch (e) {
                            console.error("[offscreen] failed to send check_internet_result:", e?.message ?? e);
                        }
                    }
                };
            }
            catch (e) {
                console.error("[offscreen] failed to create worker:", e?.message ?? e);
            }
            break;
        case "analytics:event":
            break;
    }
});

/******/ })()
;