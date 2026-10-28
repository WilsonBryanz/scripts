/**
 * @name 全自动感知环境伪装
 * @author WilsonBryanz
 * @description 结合标准， WebRTC 真实 IP 防泄漏阻断、Geolocation 经纬度动态伪装、Intl 货币深度劫持。
 */

try {
    const isResponse = typeof $response !== "undefined";

    function executeInject() {
        let targetTz = $persistentStore.read("SRE_TZ") || "America/Los_Angeles";
        let targetCc = $persistentStore.read("SRE_CC") || "US";
        let targetLoc = $persistentStore.read("SRE_LOC") || "34.0522,-118.2437"; // 默认洛杉矶经纬度

        let langMap = {
            "US": { l: "en-US", ls: "['en-US', 'en']", al: "en-US,en;q=0.9", cur: "USD" },
            "JP": { l: "ja-JP", ls: "['ja-JP', 'ja', 'en-US', 'en']", al: "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7", cur: "JPY" },
            "GB": { l: "en-GB", ls: "['en-GB', 'en-US', 'en']", al: "en-GB,en-US;q=0.9,en;q=0.8", cur: "GBP" },
            "DE": { l: "de-DE", ls: "['de-DE', 'de', 'en-US', 'en']", al: "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7", cur: "EUR" },
            "KR": { l: "ko-KR", ls: "['ko-KR', 'ko', 'en-US', 'en']", al: "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7", cur: "KRW" },
            "SG": { l: "en-SG", ls: "['en-SG', 'en-US', 'en']", al: "en-SG,en-US;q=0.9,en;q=0.8", cur: "SGD" },
            "TW": { l: "zh-TW", ls: "['zh-TW', 'zh-HK', 'zh', 'en-US', 'en']", al: "zh-TW,zh-HK;q=0.9,zh;q=0.8,en-US;q=0.7,en;q=0.6", cur: "TWD" },
            "HK": { l: "zh-HK", ls: "['zh-HK', 'zh-TW', 'zh', 'en-US', 'en']", al: "zh-HK,zh-TW;q=0.9,zh;q=0.8,en-US;q=0.7,en;q=0.6", cur: "HKD" }
        };
        let langCfg = langMap[targetCc] || langMap["US"];
        let [lat, lon] = targetLoc.split(',').map(Number);

        if (!isResponse) {
            let headers = $request.headers;
            let originalKeys = {};
            for (let key in headers) originalKeys[key.toLowerCase()] = key;
            
            if (originalKeys["accept-language"]) headers[originalKeys["accept-language"]] = langCfg.al;
            if (originalKeys["x-timezone"]) headers[originalKeys["x-timezone"]] = targetTz;
            if (originalKeys["timezone"]) headers[originalKeys["timezone"]] = targetTz;
            if (originalKeys["tz"]) headers[originalKeys["tz"]] = targetTz;
            
            $done({headers});
        } else {
            let headers = $response.headers;
            let originalKeys = {};
            for (let key in headers) originalKeys[key.toLowerCase()] = key;
            
            let cacheKey = originalKeys["cache-control"] ? originalKeys["cache-control"] : "Cache-Control";
            headers[cacheKey] = "no-store, no-cache, must-revalidate, max-age=0";
            if (originalKeys["etag"]) delete headers[originalKeys["etag"]];
            if (originalKeys["last-modified"]) delete headers[originalKeys["last-modified"]];

            let contentType = headers["Content-Type"] || headers["content-type"] || "";
            if (!contentType.toLowerCase().includes("text/html")) {
                $done({headers}); 
            } else {
                let body = $response.body;
                let injectJS = `
                <script>
                    (function() {
                        const targetTzName = '${targetTz}';
                        const fakeLat = ${lat};
                        const fakeLon = ${lon};
                        const OriginalDate = globalThis.Date;

                        // 1. 时区与时间伪装
                        let targetOffsetMin = 0; 
                        let fakeGmtOffset = "+0000";
                        try {
                            let format = new Intl.DateTimeFormat('en-US', { timeZone: targetTzName, timeZoneName: 'longOffset' }).format(new OriginalDate()); 
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

                        // 2. Intl 深度防泄漏 (日期 + 货币)
                        const __oIntlDT = Intl.DateTimeFormat;
                        Intl.DateTimeFormat = function(...args) {
                            let opts = args[1] || {};
                            if (!opts.timeZone) opts.timeZone = targetTzName;
                            return new __oIntlDT(args[0], opts);
                        };
                        const __oIntlNF = Intl.NumberFormat;
                        Intl.NumberFormat = function(...args) {
                            let opts = args[1] || {};
                            if (!opts.currency && opts.style === 'currency') opts.currency = '${langCfg.cur}';
                            return new __oIntlNF('${langCfg.l}', opts);
                        };

                        // 3. WebRTC 真实 IP 泄漏阻断
                        if (typeof window.RTCPeerConnection !== 'undefined') {
                            window.RTCPeerConnection = function() {
                                return {
                                    createDataChannel: () => ({}),
                                    createOffer: () => Promise.resolve(),
                                    setLocalDescription: () => Promise.resolve(),
                                    close: () => {}
                                };
                            };
                        }

                        // 4. Geolocation 动态经纬度伪装
                        if (navigator.geolocation) {
                            const mockPosition = {
                                coords: {
                                    latitude: fakeLat,
                                    longitude: fakeLon,
                                    accuracy: 100,
                                    altitude: null,
                                    altitudeAccuracy: null,
                                    heading: null,
                                    speed: null
                                },
                                timestamp: Date.now()
                            };
                            navigator.geolocation.getCurrentPosition = function(success) {
                                if (success) setTimeout(() => success(mockPosition), 100);
                            };
                            navigator.geolocation.watchPosition = function(success) {
                                if (success) setTimeout(() => success(mockPosition), 100);
                                return Math.floor(Math.random() * 10000);
                            };
                        }

                        // 5. 基础环境指纹锁定与沙盒防护
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
                                        if (child.contentWindow.RTCPeerConnection) {
                                            child.contentWindow.RTCPeerConnection = window.RTCPeerConnection;
                                        }
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
    }

    let lastCheck = $persistentStore.read("SRE_LAST_CHECK");
    let now = Date.now();
    
    // 增加抓取 loc (经纬度) 字段
    if (!lastCheck || (now - parseInt(lastCheck)) > 10000) {
        let reqOptions = { url: "https://ipinfo.io/json", timeout: 3000 };
        $httpClient.get(reqOptions, function(error, response, data){
            if(!error && data){
                try {
                    let obj = JSON.parse(data);
                    if(obj.timezone && obj.country) {
                        $persistentStore.write(obj.timezone, "SRE_TZ");
                        $persistentStore.write(obj.country, "SRE_CC");
                        if(obj.loc) $persistentStore.write(obj.loc, "SRE_LOC");
                        $persistentStore.write(now.toString(), "SRE_LAST_CHECK");
                    }
                } catch(e) {}
            }
            executeInject();
        });
    } else {
        executeInject();
    }

} catch (e) {
    if (typeof $response !== "undefined") $done({body: $response.body, headers: $response.headers});
    else $done({headers: $request.headers});
}
