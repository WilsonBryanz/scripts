/**
 * @name 全自动感知环境伪装 (SRE Level 9 跨海追踪版)
 * @author WilsonBryanz
 * @description 修复 iOS ATS 拦截 HTTP 导致的探针瘫痪。升级 HTTPS 探针 (ipwho.is)，实现秒级节点切换识别。
 */

try {
    // 默认兜底环境（当探针还在路上时使用）
    let targetTz = $persistentStore.read("SRE_TZ") || "America/Los_Angeles";
    let targetCc = $persistentStore.read("SRE_CC") || "US";

    // 全球主流国家语言指纹库
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
    // 【异步静默探测】：使用纯 HTTPS，完美绕过 iOS ATS 拦截
    // ----------------------------------------------------
    let lastCheck = $persistentStore.read("SRE_LAST_CHECK");
    let now = Date.now();
    // 节流阀缩短至 2 秒，只要你换节点，刷新一次立马触发探测
    if (!lastCheck || (now - parseInt(lastCheck)) > 2000) {
        $persistentStore.write(now.toString(), "SRE_LAST_CHECK");
        
        $httpClient.get("https://ipwho.is/", function(error, response, data){
            if(!error && data){
                try {
                    let obj = JSON.parse(data);
                    if(obj.timezone && obj.timezone.id) {
                        $persistentStore.write(obj.timezone.id, "SRE_TZ");
                        $persistentStore.write(obj.country_code, "SRE_CC");
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
    // 【执行引擎 B】：HTML 智能反向注入
    // ----------------------------------------------------
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
                    const targetTzName = '${targetTz}';
                    const OriginalDate = globalThis.Date;

                    let targetOffsetMin = 0; 
                    let fakeGmtOffset = "+0000";
                    try {
                        let format = new Intl.DateTimeFormat('en-US', {
                            timeZone: targetTzName,
                            timeZoneName: 'longOffset'
                        }).format(new OriginalDate()); 

                        // 强兼容正则，解决 GMT, GMT+01:00, GMT-07:00 等所有边界问题
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
                $done({body});
            } else {
                $done({});
            }
        }
    }
} catch (e) {
    if (typeof $response !== "undefined") $done({body: $response.body});
    else $done({headers: $request.headers});
}
