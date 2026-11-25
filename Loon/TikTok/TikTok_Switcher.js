/**
 * @name TikTok 智能换区 (Loon 节点联动修复版)
 * @description 根据 Proxy Group 选中的节点，自动切换 新、美、日、台、韩、英、欧洲等地区
 * @author WilsonBryanz
 * @version 1.1.1
 * @script-type http-request
 * @match ^https?:\/\/(.+\.)?(tiktokv|byteoversea|tik-tokapi)\.com\/.+
 * @requires-body false
 */

function getTikTokNode() {
    try {
        const getter = $config && ($config.getSelectedPolicy || $config.getPolicy);
        if (getter) {
            let cur = getter.call($config, "TikTok") || "";
            // 向下追踪嵌套策略组（如 TikTok -> 美国住宅 -> 具体节点）
            for (let i = 0; i < 5; i++) {
                let next = getter.call($config, cur);
                if (!next || next === cur) break;
                cur = next;
            }
            return String(cur);
        }
    } catch (e) {}
    return "";
}

const upperProxy = getTikTokNode().toUpperCase();

// 默认新加坡区兜底
let targetRegion = "SG";
let mcc = "52504";
let tz = "Asia/Singapore";

if (/美|\bUS\b|UNITED STATES/.test(upperProxy)) {
    targetRegion = "US"; mcc = "310410"; tz = "America/New_York";
} else if (/日|\bJP\b|东京|大阪/.test(upperProxy)) {
    targetRegion = "JP"; mcc = "44010"; tz = "Asia/Tokyo";
} else if (/台|\bTW\b|台北/.test(upperProxy)) {
    targetRegion = "TW"; mcc = "46692"; tz = "Asia/Taipei";
} else if (/韩|\bKR\b|首尔/.test(upperProxy)) {
    targetRegion = "KR"; mcc = "45005"; tz = "Asia/Seoul";
} else if (/英|\bUK\b|\bGB\b|伦敦|欧|\bEU\b|德|法/.test(upperProxy)) {
    targetRegion = "GB"; mcc = "23430"; tz = "Europe/London";
}

let url = $request.url;
if (url.includes("?")) {
    url = url
        .replace(/([?&](?:carrier_|sys_|account_|op_|current_)?region=)[A-Za-z]{2}(?=&|$)/g, "$1" + targetRegion)
        .replace(/([?&]mcc_mnc=)[0-9]{5,6}(?=&|$)/g, "$1" + mcc)
        .replace(/([?&]timezone_name=)[^&]+/g, "$1" + encodeURIComponent(tz));
    $done({ url });
} else {
    $done({});
}
