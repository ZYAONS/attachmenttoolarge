/******/ (() => { // webpackBootstrap
/******/ 	"use strict";

;// ./src/utils/network-utils.ts
function getErrorMessage(error) {
    if (error instanceof DOMException) {
        if (error.name === "AbortError") {
            return {
                errorCode: "TIMEOUT",
                errorMessage: "Request timed out",
            };
        }
        return {
            errorCode: "ABORTED",
            errorMessage: error.message || "Request was aborted",
        };
    }
    if (error instanceof TypeError) {
        return {
            errorCode: "NETWORK_ERROR",
            errorMessage: error.message || "Failed to fetch data",
        };
    }
    if (error instanceof Error) {
        return {
            errorCode: "UNKNOWN_ERROR",
            errorMessage: error.message || "Unknown error",
        };
    }
    return {
        errorCode: "UNKNOWN_ERROR",
        errorMessage: "Unknown error",
    };
}
async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 8000, retry = 0, ...fetchOptions } = options;
    let count = retry;
    let lastError = null;
    while (count >= 0) {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await fetch(resource, {
                ...fetchOptions,
                credentials: "omit",
                cache: "no-store",
                signal: controller.signal,
            });
            clearTimeout(id);
            if (!response.ok) {
                lastError = {
                    errorCode: "HTTP_ERROR",
                    errorMessage: `HTTP error: ${response.status} ${response.statusText || ""}`.trim(),
                };
                if (count === 0) {
                    return {
                        ok: false,
                        errorCode: "HTTP_ERROR",
                        errorMessage: lastError.errorMessage,
                        statusCode: response.status,
                        response: null
                    };
                }
            }
            else {
                return {
                    ok: true,
                    response,
                };
            }
        }
        catch (error) {
            clearTimeout(id);
            const normalizedError = getErrorMessage(error);
            lastError = normalizedError;
            if (count === 0) {
                return {
                    ok: false,
                    errorCode: normalizedError.errorCode,
                    errorMessage: normalizedError.errorMessage,
                    response: null
                };
            }
        }
        count -= 1;
    }
    return {
        ok: false,
        errorCode: "TOO_MANY_RETRIES",
        errorMessage: lastError?.errorMessage || "Too many retries",
    };
}
async function check_internet(url) {
    const zoogResult = await fetchWithTimeout(`${url}/api/ip/extension/info`, {
        method: "GET",
        retry: 2,
        timeout: 6000,
    });
    if (zoogResult.ok) {
        try {
            const json = await zoogResult.response.json();
            if (json?.ipString) {
                return {
                    ok: true,
                    value: json.ipString,
                    source: "zoog",
                };
            }
            return {
                ok: false,
                value: 500,
                source: "zoog",
                errorCode: "INVALID_RESPONSE",
                errorMessage: "Zoog API returned invalid response: ipString is missing",
            };
        }
        catch (error) {
            const normalizedError = getErrorMessage(error);
            return {
                ok: false,
                value: 500,
                source: "zoog",
                errorCode: "INVALID_JSON",
                errorMessage: `Zoog API returned invalid JSON. ${normalizedError.errorMessage}`,
            };
        }
    }
    const ipifyResult = await fetchWithTimeout("https://api.ipify.org/?format=json", {
        method: "GET",
        retry: 3,
        timeout: 8000,
    });
    if (ipifyResult.ok) {
        try {
            const json = await ipifyResult.response.json();
            if (json?.ip) {
                return {
                    ok: true,
                    value: json.ip,
                    source: "ipify",
                };
            }
            return {
                ok: false,
                value: 500,
                source: "ipify",
                errorCode: "INVALID_RESPONSE",
                errorMessage: "Ipify returned invalid response: ip is missing",
            };
        }
        catch (error) {
            const normalizedError = getErrorMessage(error);
            return {
                ok: false,
                value: 500,
                source: "ipify",
                errorCode: "INVALID_JSON",
                errorMessage: `Ipify returned invalid JSON. ${normalizedError.errorMessage}`,
            };
        }
    }
    return {
        ok: false,
        value: 500,
        source: "ipify",
        errorCode: ipifyResult.errorCode,
        errorMessage: `Zoog API failed: ${zoogResult.errorMessage}. Fallback failed: ${ipifyResult.errorMessage}`,
    };
}
async function check_ip() {
    const result = await fetchWithTimeout("https://api.ipify.org/?format=json", {
        method: "GET",
        retry: 3,
        timeout: 8000,
    });
    if (!result.ok) {
        return {
            ok: false,
            statusCode: 500,
            errorCode: result.errorCode,
            errorMessage: result.errorMessage,
        };
    }
    try {
        const json = await result.response.json();
        if (json?.ip) {
            return {
                ok: true,
                ip: json.ip,
            };
        }
        return {
            ok: false,
            statusCode: 500,
            errorCode: "INVALID_RESPONSE",
            errorMessage: "Ipify returned invalid response: ip is missing",
        };
    }
    catch (error) {
        const normalizedError = getErrorMessage(error);
        return {
            ok: false,
            statusCode: 500,
            errorCode: "INVALID_JSON",
            errorMessage: `Invalid JSON response. ${normalizedError.errorMessage}`,
        };
    }
}

;// ./src/background/web_worker.ts

onmessage = async (e) => {
    if (e.data[0] === "check_internet_worker" && e.data[1]) {
        const url = e.data[1];
        const attemptId = e.data[2];
        const data = await check_internet(url);
        postMessage(["check_internet_result_worker", data, attemptId]);
    }
};

/******/ })()
;