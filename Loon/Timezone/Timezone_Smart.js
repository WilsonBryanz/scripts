/**
 * @name 全自动感知环境伪装 (SRE Level 7 原生反向适配版)
 * @author WilsonBryanz
 * @description 抛弃不准的第三方 IP 库，直接动态获取浏览器底层的原生理应时差，进行 1:1 像素级伪装，解决美东美西错位问题。
 */

try {
    let proxyName = "";
    if (typeof $agent !== "undefined" && $agent && $agent.name) {
        proxyName = $agent.name.toUpperCase();
    } else if (typeof $environment !== "undefined" && $environment.system) {
        proxyName = $environment.system.toUpperCase();
    }

    // 基础语言兜底（默认美国）
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
    
    // 简单粗暴的关键字语言匹配，不再依赖网络探测
    let cc = "US";
    if (proxyName.includes("JP") || proxyName.includes("日")) cc = "JP";
    else if (proxyName.includes("UK") || proxyName.includes("英")) cc = "GB";
    else if (proxyName.includes("DE") || proxyName.includes("德") || proxyName.includes("欧")) cc = "DE";
    else if (proxyName.includes("KR") || proxyName.includes("韩")) cc = "KR";
    else if (proxyName.includes("SG") || proxyName.includes("新")) cc = "SG";
    else if (proxyName.includes("TW") || proxyName.includes("台")) cc = "TW";
    else if (proxyName.includes("HK") || proxyName.includes("港")) cc = "HK";
    
    let langCfg = langMap[cc];

    // 执行引擎 A：API 拦截 (只处理语言)
    if (typeof $response === "undefined") {
        let headers = $request.headers;
        let originalKeys = {};
        for (let key in headers) originalKeys[key.toLowerCase()] = key;
        if (originalKeys["accept-language"]) {
            headers[originalKeys["accept-language"]] = langCfg.al;
        }
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
                    // 1. 直接窃取当前网页认为的正确时区（利用 Intl API 反向推导）
                    let targetTzName = 'America/New_York';
                    let targetOffsetMin = 300;
                    try {
                        targetTzName = Intl.DateTimeFormat().resolvedOptions().timeZone;
                        // 获取当前时区在 1 月 1 日（避开夏令时变动期）的基础偏移量
                        let testDate = new Date(new Date().getFullYear(), 0, 1);
                        let tzString = testDate.toLocaleString('en-US', { timeZone: targetTzName, timeZoneName: 'longOffset' });
                        let match = tzString.match(/GMT([+-]\\d{2}):(\\d{2})/);
                        if (match) {
                            let sign = match[1].charAt(0) === '+' ? -1 : 1;
                            let hours = parseInt(match[1].substring(1), 10);
                            let mins = parseInt(match[2], 10);
                            targetOffsetMin = sign * (hours * 60 + mins);
                        }
                    } catch (e) {}

                    // 2. 动态计算时差
                    const OriginalDate = globalThis.Date;
                    const systemOffsetMin = new OriginalDate().getTimezoneOffset();
                    const diffMin = systemOffsetMin - targetOffsetMin; 
                    const fakeTimeOffsetMs = diffMin * 60 * 1000;

                    // 3. 构建伪装字符串
                    let sign = targetOffsetMin > 0 ? "-" : "+";
                    let absHour = Math.floor(Math.abs(targetOffsetMin) / 60).toString().padStart(2, '0');
                    let absMin = (Math.abs(targetOffsetMin) % 60).toString().padStart(2, '0');
                    const fakeTzStr = 'GMT' + sign + absHour + absMin + ' (' + targetTzName + ')';
                    const tzRegex = /GMT[+-]\\d{4}\\s*\\(.*?\\)/;

                    // 4. 重写 Date 对象
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

                    // 5. 环境指纹与沙盒逃逸
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
