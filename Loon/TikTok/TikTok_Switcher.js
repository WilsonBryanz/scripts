/**
 * @name TikTok 智能换区 (Loon 节点联动修复版)
 * @description 根据 Proxy Group 选中的节点，自动切换 新、美、日、台、韩、英、欧洲等地区
 * @description 读取 TikTok 策略组当前落地节点，自动改写地区、运营商代码与时区参数
 * @author WilsonBryanz
 * @version 1.2.0
 * @script-type http-request
 * @match ^https?:\/\/(.+\.)?(tiktokv|byteoversea|tik-tokapi)\.com\/.+
 * @requires-body false
 */

function decodePolicy(val) {
    if (typeof val !== "string") {
        return val && typeof val === "object" ? (val.now || val.name || "") : "";
    }
    const str = val.trim();
    if (!str || str === "null" || str === "undefined") return "";
    if (str[0] === '"' || str[0] === "{") {
        try {
            return decodePolicy(JSON.parse(str));
        } catch (e) {
            return str;
        }
    }
    return str;
}

function getTikTokNode() {
    try {
        const getter = $config && ($config.getSelectedPolicy || $config.getPolicy);
        if (getter) {
            let current = decodePolicy(getter.call($config, "TikTok"));
            // 最多向下追踪 5 层嵌套策略组（例如：TikTok -> 美国住宅 -> 具体落地节点）
            for (let i = 0; i < 5; i++) {
                const next = decodePolicy(getter.call($config, current));
                if (!next || next === current) break;
                current = next;
            }
            return String(current);
        }
    } catch (e) {}
    return "";
}

const upperProxy = getTikTokNode().toUpperCase();

// 默认新加坡区兜底
let targetRegion = "SG";
let mcc = "52504";
let tz = "Asia/Singapore";

if (/美|\bUS\b|USA|UNITED STATES|洛杉矶|圣何塞|西雅图|硅谷|达拉斯|芝加哥|凤凰城|纽约/.test(upperProxy)) {
    targetRegion = "US";
    mcc = "310410";
    tz = "America/New_York";
} else if (/日|\bJP\b|JAPAN|东京|大阪|埼玉/.test(upperProxy)) {
    targetRegion = "JP";
    mcc = "44010";
    tz = "Asia/Tokyo";
} else if (/台|\bTW\b|TAIWAN|台北|台湾/.test(upperProxy)) {
    targetRegion = "TW";
    mcc = "46692";
    tz = "Asia/Taipei";
} else if (/韩|\bKR\b|KOREA|首尔|韩国/.test(upperProxy)) {
    targetRegion = "KR";
    mcc = "45005";
    tz = "Asia/Seoul";
} else if (/英|\bUK\b|\bGB\b|伦敦|欧|\bEU\b|德|法|荷|意|瑞/.test(upperProxy)) {
    targetRegion = "GB";
    mcc = "23430";
    tz = "Europe/London";
}

let url = $request.url;
if (url.includes("?")) {
    url = url
        .replace(/([?&](?:carrier_|sys_|account_|op_|current_|app_)?region=)[A-Za-z]{2}(?=&|$)/gi, "$1" + targetRegion)
        .replace(/([?&]mcc_mnc=)[0-9]{5,6}(?=&|$)/g, "$1" + mcc)
        .replace(/([?&](?:timezone_name|tz_name)=)[^&]+/g, "$1" + encodeURIComponent(tz));
    $done({ url });
} else {
    $done({});
}
