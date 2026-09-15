/******/ (() => { // webpackBootstrap
/******/ 	"use strict";

;// ./src/contentScript/click-stream.ts
function runClickStream() {
    const reportUrlChange = () => {
        chrome.runtime.sendMessage({
            type: "clickstream-event",
            payload: {
                timestamp: new Date().toISOString(),
                url: location.href,
                referer: document.referrer || undefined,
                user_agent: navigator.userAgent,
            }
        });
    };
}

;// ./src/contentScript/index.ts

runClickStream();

/******/ })()
;