/**
 * @name 全自动感知环境伪装 (SRE Level 10 终极缓存击穿版)
 * @author WilsonBryanz
 * @description 引入 HTTP Headers 强制缓存清洗 (Cache-Busting) 机制，彻底粉碎 Safari 本地幽灵缓存。探针升级为顶级 ipinfo.io HTTPS 接口。
 */

try {
    let targetTz = $persistentStore.read("SRE_TZ") || "America/Los_Angeles";
    let targetCc = $persistentStore.read("SRE_CC") || "US";

    let langMap = {
        "US": { l: "en-US", ls: "['en-US', 'en']", al: "en-US,en;q=0.9" },
        "JP": { l: "ja-JP", ls: "['ja-JP', 'ja', 'en-US', 'en']", al: "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7" },
        "GB": { l: "en-GB", ls: "['en-GB', 'en-US', 'en']", al: "en-GB,en-US;q=0.9,en;q=0.8" },
        "DE": { l: "de-DE", ls: "['de-DE', 'de', 'en-US', 'en']", al: "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7" },
        "KR": { l: "ko-KR", ls: "['ko-KR', 'ko', 'en-US', 'en']", al: "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7" },
        "SG": { l: "en-SG", ls: "['en-SG', 'en-US', 'en']", al: "en-SG,en-US;q=0.9,en;q=0.8" },
        "TW": { l: "zh-TW", ls: "['zh-TW', 'zh-HK', 'zh', 'en-US', 'en']", al: "zh-TW,zh-HK;q=0.9,zh;q=0.8,en-US;q=0.7,en;q=0.6" },
        "HK": { l: "zh-HK", ls: "['zh-HK', 'zh-TW', 'zh', 'en-US', 'en']", al: "zh-HK,zh-TW;q=0.9,zh;q=0.8,en-US;q=0.7,en;q=0.6" }
    };
    let langCfg = langMap[targetCc] || langMap["US"];

    // ----------------------------------------------------
    // 【异步静默探测】：顶级 HTTPS 接口 (ipinfo.io)，绝不被拦截
    // ----------------------------------------------------
    let lastCheck = $persistentStore.read("SRE_LAST_CHECK");
    let now = Date.now();
    if (!lastCheck || (now - parseInt(lastCheck)) > 2000) {
        $persistentStore.write(now.toString(), "SRE_LAST_CHECK");
        $httpClient.get("https://ipinfo.io/json", function(error, response, data){
            if(!error && data){
                try {
                    let obj = JSON.parse(data);
                    if(obj.timezone && obj.country) {
                        $persistentStore.write(obj.timezone, "SRE_TZ");
                        $persistentStore.write(obj.country, "SRE_CC");
                    }
                } catch(e) {}
            }
        });
    }

    // ----------------------------------------------------
    // 【执行引擎 A】：API 请求头拦截
    // ----------------------------------------------------
    if (typeof $response === "undefined") {
        let headers = $request.headers;
        let originalKeys = {};
        for (let key in headers) originalKeys[key.toLowerCase()] = key;
        
        if (originalKeys["accept-language"]) headers[originalKeys["accept-language"]] = langCfg.al;
        if (originalKeys["x-timezone"]) headers[originalKeys["x-timezone"]] = targetTz;
        if (originalKeys["timezone"]) headers[originalKeys["timezone"]] = targetTz;
        if (originalKeys["tz"]) headers[originalKeys["tz"]] = targetTz;
        
        $done({headers});
    }

    // ----------------------------------------------------
    // 【执行引擎 B】：HTML 强力注入 + 强制缓存击穿
    // ----------------------------------------------------
    if (typeof $response !== "undefined") {
        let headers = $response.headers;
        let originalKeys = {};
        for (let key in headers) originalKeys[key.toLowerCase()] = key;
        
        // 💥 核心修复：注入强制清理缓存的 Header 指令
        let cacheKey = originalKeys["cache-control"] ? originalKeys["cache-control"] : "Cache-Control";
        headers[cacheKey] = "no-store, no-cache, must-revalidate, max-age=0";
        if (originalKeys["etag"]) delete headers[originalKeys["etag"]];
        if (originalKeys["last-modified"]) delete headers[originalKeys["last-modified"]];

        let contentType = headers["Content-Type"] || headers["content-type"] || "";
        if (!contentType.toLowerCase().includes("text/html")) {
            $done({headers}); // 哪怕不是 HTML 也要下发清缓存指令
        } else {
            let body = $response.body;
            let injectJS = `
            <script>
                (function() {
                    const targetTzName = '${targetTz}';
                    const OriginalDate = globalThis.Date;

                    let targetOffsetMin = 0; 
                    let fakeGmtOffset = "+0000";
                    try {
                        let format = new Intl.DateTimeFormat('en-US', {
                            timeZone: targetTzName,
                            timeZoneName: 'longOffset'
                        }).format(new OriginalDate()); 

                        let match = format.match(/GMT([+-])(\\d{2}):?(\\d{2})?/);
                        if (match) {
                            let sign = match[1] === '+' ? -1 : 1;
                            let hours = parseInt(match[2], 10);
                            let mins = match[3] ? parseInt(match[3], 10) : 0;
                            targetOffsetMin = sign * (hours * 60 + mins);
                            fakeGmtOffset = match[1] + match[2].padStart(2, '0') + (match[3] ? match[3].padStart(2, '0') : '00');
                        }
                    } catch (e) {}

                    const systemOffsetMin = new OriginalDate().getTimezoneOffset();
                    const diffMin = systemOffsetMin - targetOffsetMin; 
                    const fakeTimeOffsetMs = diffMin * 60 * 1000;

                    const fakeTzStr = 'GMT' + fakeGmtOffset + ' (' + targetTzName + ')';
                    const tzRegex = /GMT[+-]\\d{4}\\s*\\(.*?\\)/;

                    const HookedDate = function(...args) {
                        if (new.target === undefined) return new HookedDate().toString();
                        if (args.length === 0) return new OriginalDate(OriginalDate.now() + fakeTimeOffsetMs);
                        return new OriginalDate(...args);
                    };
                    
                    Object.getOwnPropertyNames(OriginalDate).forEach(prop => {
                        try { HookedDate[prop] = OriginalDate[prop]; } catch(e) {}
                    });
                    HookedDate.now = function() { return OriginalDate.now() + fakeTimeOffsetMs; };
                    HookedDate.prototype = OriginalDate.prototype;
                    HookedDate.prototype.constructor = HookedDate;
                    
                    const origToString = OriginalDate.prototype.toString;
                    HookedDate.prototype.toString = function() { return origToString.call(this).replace(tzRegex, fakeTzStr); };
                    const origToTimeString = OriginalDate.prototype.toTimeString;
                    HookedDate.prototype.toTimeString = function() { return origToTimeString.call(this).replace(tzRegex, fakeTzStr); };
                    HookedDate.prototype.getTimezoneOffset = function() { return targetOffsetMin; };
                    globalThis.Date = HookedDate;

                    const __oIntl = Intl.DateTimeFormat;
                    Intl.DateTimeFormat = function(...args) {
                        let opts = args[1] || {};
                        if (!opts.timeZone) opts.timeZone = targetTzName;
                        return new __oIntl(args[0], opts);
                    };

                    const navProto = Object.getPrototypeOf(navigator);
                    Object.defineProperty(navProto, 'language', { get: () => '${langCfg.l}' });
                    Object.defineProperty(navProto, 'languages', { get: () => ${langCfg.ls} });
                    Object.defineProperty(navProto, 'hardwareConcurrency', { get: () => 8 });
                    Object.defineProperty(navProto, 'deviceMemory', { get: () => 8 });

                    if (typeof document !== 'undefined') {
                        const origAppendChild = Node.prototype.appendChild;
                        Node.prototype.appendChild = function(child) {
                            const res = origAppendChild.call(this, child);
                            if (child && child.tagName && child.tagName.toLowerCase() === 'iframe') {
                                try {
                                    child.contentWindow.Date = globalThis.Date;
                                    child.contentWindow.Intl = globalThis.Intl;
                                    const ifNavProto = Object.getPrototypeOf(child.contentWindow.navigator);
                                    Object.defineProperty(ifNavProto, 'language', { get: () => '${langCfg.l}' });
                                    Object.defineProperty(ifNavProto, 'languages', { get: () => ${langCfg.ls} });
                                } catch(e) {}
                            }
                            return res;
                        };
                    }
                })();
            </script>`;

            if (body && typeof body === "string") {
                if (/<head[^>]*>/i.test(body)) body = body.replace(/(<head[^>]*>)/i, `$1${injectJS}`);
                else if (/<html[^>]*>/i.test(body)) body = body.replace(/(<html[^>]*>)/i, `$1${injectJS}`);
                else body = injectJS + body;
                $done({body, headers});
            } else {
                $done({headers});
            }
        }
    }
} catch (e) {
    if (typeof $response !== "undefined") $done({body: $response.body, headers: $response.headers});
    else $done({headers: $request.headers});
}
