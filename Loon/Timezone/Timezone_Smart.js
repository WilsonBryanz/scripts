/**
 * @name 全自动感知环境伪装 (Loon 终极自适应版)
 * @author WilsonBryanz
 * @description 引入惰性嗅探 (Cache-Aside) 架构。无论如何切换节点，自动后台检测落地 IP，精准计算毫秒级时差与语言指纹。
 */

try {
    let tzName = $persistentStore.read("SRE_TZ") || "America/New_York";
    let cc = $persistentStore.read("SRE_CC") || "US";
    let gmtOffset = $persistentStore.read("SRE_GMT") || "-0500";
    let timeOffsetMs = parseInt($persistentStore.read("SRE_OFFSET_MS") || "-46800000");
    let tzOffsetMin = parseInt($persistentStore.read("SRE_OFFSET_MIN") || "300");

    let langMap = {
        "US": { l: "en-US", ls: "['en-US', 'en']", al: "en-US,en;q=0.9" },
        "JP": { l: "ja-JP", ls: "['ja-JP', 'ja', 'en-US', 'en']", al: "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7" },
        "GB": { l: "en-GB", ls: "['en-GB', 'en-US', 'en']", al: "en-GB,en-US;q=0.9,en;q=0.8" },
        "DE": { l: "de-DE", ls: "['de-DE', 'de', 'en-US', 'en']", al: "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7" },
        "KR": { l: "ko-KR", ls: "['ko-KR', 'ko', 'en-US', 'en']", al: "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7" },
        "SG": { l: "en-SG", ls: "['en-SG', 'en-US', 'en']", al: "en-SG,en-US;q=0.9,en;q=0.8" },
        "TW": { l: "zh-TW", ls: "['zh-TW', 'zh-HK', 'zh', 'en-US', 'en']", al: "zh-TW,zh-HK;q=0.9,zh;q=0.8,en-US;q=0.7,en;q=0.6" },
        "HK": { l: "zh-HK", ls: "['zh-HK', 'zh-TW', 'zh', 'en-US', 'en']", al: "zh-HK,zh-TW;q=0.9,zh;q=0.8,en-US;q=0.7,en;q=0.6" },
        "AE": { l: "ar-AE", ls: "['ar-AE', 'ar', 'en-US', 'en']", al: "ar-AE,ar;q=0.9,en-US;q=0.8,en;q=0.7" }
    };
    let langCfg = langMap[cc] || langMap["US"];

    // 【异步静默探测】
    let lastCheck = $persistentStore.read("SRE_LAST_CHECK");
    let now = Date.now();
    if (!lastCheck || (now - parseInt(lastCheck)) > 60000) {
        $persistentStore.write(now.toString(), "SRE_LAST_CHECK");
        // 放行异步请求，不阻塞底层网络
        $httpClient.get("http://ip-api.com/json/?fields=countryCode,timezone,offset", function(error, response, data){
            if(!error && data){
                try {
                    let obj = JSON.parse(data);
                    if(obj.timezone && obj.countryCode) {
                        $persistentStore.write(obj.timezone, "SRE_TZ");
                        $persistentStore.write(obj.countryCode, "SRE_CC");
                        let targetOffsetMin = obj.offset / 60; 
                        let systemOffsetMin = -(new Date().getTimezoneOffset());
                        let diffMin = targetOffsetMin - systemOffsetMin;
                        let calculatedTimeOffsetMs = diffMin * 60 * 1000;
                        let calculatedTzOffsetMin = -targetOffsetMin; 
                        let sign = obj.offset >= 0 ? "+" : "-";
                        let absHour = Math.floor(Math.abs(obj.offset) / 3600).toString().padStart(2, '0');
                        let absMin = Math.floor((Math.abs(obj.offset) % 3600) / 60).toString().padStart(2, '0');
                        let gmtStr = sign + absHour + absMin;
                        $persistentStore.write(gmtStr, "SRE_GMT");
                        $persistentStore.write(calculatedTimeOffsetMs.toString(), "SRE_OFFSET_MS");
                        $persistentStore.write(calculatedTzOffsetMin.toString(), "SRE_OFFSET_MIN");
                    }
                } catch(e) {}
            }
        });
    }

    // 执行引擎 A：API 拦截
    if (typeof $response === "undefined") {
        let url = $request.url;
        let headers = $request.headers;
        let originalKeys = {};
        for (let key in headers) originalKeys[key.toLowerCase()] = key;
        let modifyHeader = (targetKey, value) => { if (originalKeys[targetKey]) headers[originalKeys[targetKey]] = value; };

        modifyHeader("x-timezone", tzName);
        modifyHeader("timezone", tzName);
        modifyHeader("tz", tzName);
        modifyHeader("x-gmt-offset", gmtOffset);
        modifyHeader("accept-language", langCfg.al);

        if (url.includes("timezone=")) url = url.replace(/(timezone=)[^&]+/g, '$1' + encodeURIComponent(tzName));
        $done({url, headers});
    }

    // 执行引擎 B：HTML 暴力注入
    if (typeof $response !== "undefined") {
        let headers = $response.headers;
        let contentType = headers["Content-Type"] || headers["content-type"] || "";
        if (!contentType.toLowerCase().includes("text/html")) {
            $done({});
        } else {
            let body = $response.body;
            let injectJS = `
            <script>
                (function() {
                    const OriginalDate = globalThis.Date;
                    const fakeTzName = '${tzName}'; const fakeGmtOffset = '${gmtOffset}';
                    const fakeTimeOffsetMs = ${timeOffsetMs}; const fakeTzOffsetMin = ${tzOffsetMin};
                    const tzRegex = /GMT[+-]\\d{4}\\s*\\(.*?\\)/;
                    const fakeTzStr = 'GMT' + fakeGmtOffset + ' (' + fakeTzName + ')';

                    const HookedDate = function(...args) {
                        if (new.target === undefined) {
                            return new HookedDate().toString();
                        }
                        if (args.length === 0) {
                            return new OriginalDate(OriginalDate.now() + fakeTimeOffsetMs);
                        }
                        return new OriginalDate(...args);
                    };
                    
                    Object.getOwnPropertyNames(OriginalDate).forEach(prop => {
                        try { HookedDate[prop] = OriginalDate[prop]; } catch(e) {}
                    });
                    HookedDate.now = function() { return OriginalDate.now() + fakeTimeOffsetMs; };
                    HookedDate.prototype = OriginalDate.prototype;
                    HookedDate.prototype.constructor = HookedDate;
                    
                    const origToString = OriginalDate.prototype.toString;
                    HookedDate.prototype.toString = function() {
                        return origToString.call(this).replace(tzRegex, fakeTzStr);
                    };
                    const origToTimeString = OriginalDate.prototype.toTimeString;
                    HookedDate.prototype.toTimeString = function() {
                        return origToTimeString.call(this).replace(tzRegex, fakeTzStr);
                    };
                    HookedDate.prototype.getTimezoneOffset = function() {
                        return fakeTzOffsetMin;
                    };
                    globalThis.Date = HookedDate;

                    const __oIntl = Intl.DateTimeFormat;
                    Intl.DateTimeFormat = function(...args) {
                        let opts = args[1] || {};
                        if (!opts.timeZone) opts.timeZone = fakeTzName;
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
                $done({body});
            } else {
                $done({});
            }
        }
    }
} catch (e) {
    // 终极护盾：即便脚本发生严重崩溃，也安全放行流量不断网
    if (typeof $response !== "undefined") {
        $done({body: $response.body});
    } else {
        $done({url: $request.url, headers: $request.headers});
    }
}
