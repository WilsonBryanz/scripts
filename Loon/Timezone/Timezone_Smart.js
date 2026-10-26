/**
 * @name 全自动感知环境伪装 (SRE Level 8 精准校准版)
 * @author WilsonBryanz
 * @description 修复 Intl 探针泄漏物理时区的致命错误。利用目标时区反向计算 DST (夏令时) 偏移量，默认精准适配美西 (Oracle Cloud) 节点。
 */

try {
    // 默认兜底环境改为美西（洛杉矶），完美匹配你的 Oracle Cloud 节点
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

    // 静默探测 (仅获取目标时区名称，不再自己算时差，防错位)
    let lastCheck = $persistentStore.read("SRE_LAST_CHECK");
    let now = Date.now();
    if (!lastCheck || (now - parseInt(lastCheck)) > 60000) {
        $persistentStore.write(now.toString(), "SRE_LAST_CHECK");
        $httpClient.get("http://ip-api.com/json/?fields=countryCode,timezone", function(error, response, data){
            if(!error && data){
                try {
                    let obj = JSON.parse(data);
                    if(obj.timezone && obj.countryCode) {
                        $persistentStore.write(obj.timezone, "SRE_TZ");
                        $persistentStore.write(obj.countryCode, "SRE_CC");
                    }
                } catch(e) {}
            }
        });
    }

    // 执行引擎 A：API 请求头拦截
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

    // 执行引擎 B：HTML 智能反向注入
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

                    // 1. 利用 Intl 引擎强行计算目标时区（如洛杉矶）在此时此刻的绝对偏移量
                    // 这能完美解决夏令时 (PDT -0700) 与冬令时 (PST -0800) 的动态切换问题
                    let targetOffsetMin = 420; 
                    let fakeGmtOffset = "-0700";
                    try {
                        let format = new Intl.DateTimeFormat('en-US', {
                            timeZone: targetTzName,
                            timeZoneName: 'longOffset'
                        }).format(new OriginalDate()); 

                        let match = format.match(/GMT([+-])(\\d{2}):(\\d{2})/);
                        if (match) {
                            let sign = match[1] === '+' ? -1 : 1;
                            let hours = parseInt(match[2], 10);
                            let mins = parseInt(match[3], 10);
                            targetOffsetMin = sign * (hours * 60 + mins);
                            fakeGmtOffset = match[1] + match[2] + match[3];
                        }
                    } catch (e) {}

                    // 2. 动态计算时差：系统真实偏移(中国 -480) - 目标偏移(美西 420) = -900分钟
                    const systemOffsetMin = new OriginalDate().getTimezoneOffset();
                    const diffMin = systemOffsetMin - targetOffsetMin; 
                    const fakeTimeOffsetMs = diffMin * 60 * 1000;

                    // 3. 构建伪装字符串 (例如: GMT-0700 (America/Los_Angeles))
                    const fakeTzStr = 'GMT' + fakeGmtOffset + ' (' + targetTzName + ')';
                    const tzRegex = /GMT[+-]\\d{4}\\s*\\(.*?\\)/;

                    // 4. 重写底层 Date 对象
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
                        return targetOffsetMin;
                    };
                    globalThis.Date = HookedDate;

                    // 5. 劫持 Intl 国际化 API
                    const __oIntl = Intl.DateTimeFormat;
                    Intl.DateTimeFormat = function(...args) {
                        let opts = args[1] || {};
                        if (!opts.timeZone) opts.timeZone = targetTzName;
                        return new __oIntl(args[0], opts);
                    };

                    // 6. 环境指纹锁定与 Iframe 沙盒追杀
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
