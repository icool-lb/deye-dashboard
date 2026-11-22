// eWeLink (Sonoff) cloud v2 connector: OAuth login of the iCOOL account (customers share their devices with it),
// device list and on/off control. Needs EWELINK_APPID / EWELINK_SECRET from dev.ewelink.cc.
import crypto from "node:crypto";
import { rpc } from "./db.js";

const APPID = () => process.env.EWELINK_APPID || "";
const SECRET = () => process.env.EWELINK_SECRET || "";
export const BASE_URL = process.env.PUBLIC_URL || "https://icool-deye-monitor.vercel.app";
export const REDIRECT = `${BASE_URL}/api/ewelink-cb`;
export const configured = () => !!(APPID() && SECRET());
const sign = (msg) => crypto.createHmac("sha256", SECRET()).update(typeof msg === "string" ? msg : JSON.stringify(msg)).digest("base64");
const nonce = () => Math.random().toString(36).slice(-8);
const host = (region) => `https://${region || "eu"}-apia.coolkit.${["cn", "test"].includes(region) ? "cn" : "cc"}`;
export const stateTok = () => crypto.createHmac("sha256", process.env.DB_SECRET || "x").update("ewelink-state").digest("hex").slice(0, 16);

export function loginUrl() {
  const seq = String(Date.now());
  const p = { clientId: APPID(), redirectUrl: REDIRECT, grantType: "authorization_code", state: stateTok(), nonce: nonce(), seq, authorization: sign(`${APPID()}_${seq}`) };
  return "https://c2ccdn.coolkit.cc/oauth/index.html?" + Object.entries(p).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
}

async function post(region, path, body, auth) {
  const r = await fetch(host(region) + path, { method: "POST", headers: { "content-type": "application/json", "X-CK-Appid": APPID(), "X-CK-Nonce": nonce(), Authorization: auth || `Sign ${sign(body)}` }, body: JSON.stringify(body) });
  return r.json();
}

export async function exchange(code, region) {
  const j = await post(region, "/v2/user/oauth/token", { redirectUrl: REDIRECT, code, grantType: "authorization_code" });
  if (j.error) throw new Error(`eWeLink: ${j.msg || j.error}`);
  const tok = { region, at: j.data.accessToken, rt: j.data.refreshToken, atExp: j.data.atExpiredTime, rtExp: j.data.rtExpiredTime, linkedAt: new Date().toISOString() };
  await rpc("set_setting", { k: "ewelink", v: tok });
  return tok;
}

async function token() {
  const t = await rpc("get_setting", { k: "ewelink" }).catch(() => null);
  if (!t?.at) throw new Error("حساب eWeLink غير مربوط بعد");
  if (t.atExp && Date.now() > Number(t.atExp) - 3 * 86400e3) {
    const j = await post(t.region, "/v2/user/refresh", { rt: t.rt });
    if (!j.error) { Object.assign(t, { at: j.data.at, rt: j.data.rt, atExp: Date.now() + 29 * 86400e3 }); await rpc("set_setting", { k: "ewelink", v: t }); }
  }
  return t;
}

async function api(method, path, body) {
  const t = await token();
  const url = host(t.region) + path + (method === "GET" && body ? "?" + new URLSearchParams(body) : "");
  const r = await fetch(url, { method, headers: { "content-type": "application/json", "X-CK-Appid": APPID(), "X-CK-Nonce": nonce(), Authorization: `Bearer ${t.at}` }, body: method === "GET" ? undefined : JSON.stringify(body) });
  const j = await r.json();
  if (j.error) throw new Error(`eWeLink: ${j.msg || j.error}`);
  return j.data;
}

export async function status() {
  const t = await rpc("get_setting", { k: "ewelink" }).catch(() => null);
  return { configured: configured(), linked: !!t?.at, region: t?.region || null, linkedAt: t?.linkedAt || null };
}

export async function devices() {
  const out = []; let beginIndex = -9999999;
  for (let p = 0; p < 20; p++) {
    const d = await api("GET", "/v2/device/thing", { num: 30, beginIndex });
    const list = d.thingList || [];
    for (const it of list) {
      if (it.itemType !== 1 && it.itemType !== 2) continue;
      const x = it.itemData || {};
      const ch = Array.isArray(x.params?.switches) ? x.params.switches.map((s) => ({ outlet: s.outlet, on: s.switch === "on" })) : null;
      out.push({ id: x.deviceid, name: x.name, online: !!x.online, model: x.productModel || x.extra?.model || "", channels: ch, on: x.params?.switch ? x.params.switch === "on" : null, power: Number(x.params?.power ?? x.params?.actPow_00 ?? NaN) || null });
    }
    if (list.length < 30) break;
    beginIndex = list[list.length - 1]?.index ?? beginIndex + 30;
  }
  return out;
}

export async function setSwitch(id, on, outlet = null) {
  const params = outlet === null || outlet === undefined || outlet === "" ? { switch: on ? "on" : "off" } : { switches: [{ switch: on ? "on" : "off", outlet: Number(outlet) }] };
  return api("POST", "/v2/device/thing/status", { type: 1, id, params });
}
