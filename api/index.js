export const config = { runtime: "edge" };

// ── کش کردن متغیرها در cold start ────────────────────────────────────────────
const PROXY_PATH = "/proxy/";
const PASSWORD   = (process.env.PROXY_PASS || "").trim();

// هدرهایی که نباید forward بشن
const STRIP_REQ = new Set([
  "host","connection","keep-alive","te","trailer",
  "transfer-encoding","upgrade","proxy-authenticate",
  "proxy-authorization","forwarded",
  "x-forwarded-host","x-forwarded-port","x-forwarded-proto",
]);
const STRIP_RES = new Set([
  "connection","keep-alive","transfer-encoding","trailer",
  "alt-svc","x-frame-options","content-security-policy",
  "content-security-policy-report-only","x-content-type-options",
]);

// ── HTML صفحه اصلی ────────────────────────────────────────────────────────────
const HOME_HTML = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Proxy</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{
    background:#0f1117;color:#e2e8f0;
    font-family:system-ui,sans-serif;
    min-height:100vh;display:flex;align-items:center;justify-content:center;
    padding:20px;
  }
  .card{
    width:100%;max-width:520px;
    background:#1a1f2e;border:1px solid #2d3748;
    border-radius:16px;padding:32px 28px;
  }
  h1{font-size:22px;font-weight:700;margin-bottom:6px;color:#fff}
  p{font-size:13px;color:#718096;margin-bottom:24px}
  .row{display:flex;gap:8px;margin-bottom:12px}
  input{
    flex:1;padding:11px 14px;border-radius:10px;
    background:#252d3d;border:1px solid #3a4256;
    color:#e2e8f0;font-size:14px;outline:none;
  }
  input:focus{border-color:#4a9eff}
  button{
    padding:11px 20px;border-radius:10px;
    background:#4a9eff;border:none;
    color:#fff;font-size:14px;font-weight:600;
    cursor:pointer;white-space:nowrap;
  }
  button:hover{background:#3a8ef0}
  .tip{font-size:12px;color:#4a5568;margin-top:16px;line-height:1.7}
  .tip a{color:#4a9eff;text-decoration:none}
  #pass-row{margin-bottom:16px;display:none}
  #pass-row.show{display:flex}
</style>
</head>
<body>
<div class="card">
  <h1>🌐 Proxy</h1>
  <p>آدرس سایت مورد نظر را وارد کنید</p>

  <div class="row" id="pass-row">
    <input type="password" id="pass" placeholder="رمز عبور" autocomplete="off">
  </div>
  <div class="row">
    <input type="text" id="url" placeholder="https://example.com" autocomplete="off" autocorrect="off">
    <button onclick="go()">برو</button>
  </div>

  <p class="tip">
    نمونه: <a href="#" onclick="seturl('https://www.google.com')">google.com</a> ·
    <a href="#" onclick="seturl('https://github.com')">github.com</a> ·
    <a href="#" onclick="seturl('https://ipinfo.io/json')">IP من</a>
  </p>
</div>
<script>
  var needPass = ${PASSWORD.length > 0};
  if(needPass) document.getElementById('pass-row').classList.add('show');

  function seturl(u){ document.getElementById('url').value=u; }

  function go(){
    var url = document.getElementById('url').value.trim();
    if(!url) return;
    if(!/^https?:\\/\\//.test(url)) url = 'https://' + url;
    var pass = document.getElementById('pass').value.trim();
    var dest = '/proxy/' + url;
    if(pass) dest += (url.includes('?')?'&':'?') + '__pp=' + encodeURIComponent(pass);
    window.location.href = dest;
  }

  document.getElementById('url').addEventListener('keydown', function(e){
    if(e.key==='Enter') go();
  });
</script>
</body>
</html>`;

// ── helper: rewrite لینک‌ها در HTML/CSS ──────────────────────────────────────
function rewriteHtml(html, baseUrl, proxyBase, passParam) {
  const base = new URL(baseUrl);
  const pp   = passParam ? `?__pp=${encodeURIComponent(passParam)}` : "";

  function toProxyUrl(url) {
    if (!url || url.startsWith("data:") || url.startsWith("blob:") ||
        url.startsWith("javascript:") || url.startsWith("#")) return url;
    try {
      const abs = new URL(url, base).href;
      return proxyBase + abs + pp;
    } catch { return url; }
  }

  // rewrite href / src / action / srcset / url() در style
  return html
    .replace(/(<(?:a|link|area)[^>]+href\s*=\s*)(['"])(.*?)\2/gi, (m,p1,q,v) => p1+q+toProxyUrl(v)+q)
    .replace(/(<(?:img|script|iframe|source|track|embed|input)[^>]+src\s*=\s*)(['"])(.*?)\2/gi, (m,p1,q,v) => p1+q+toProxyUrl(v)+q)
    .replace(/(<form[^>]+action\s*=\s*)(['"])(.*?)\2/gi, (m,p1,q,v) => p1+q+toProxyUrl(v)+q)
    .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (m,q,v) => `url(${q}${toProxyUrl(v)}${q})`)
    .replace(/(<meta[^>]+http-equiv\s*=\s*['"]refresh['"][^>]+content\s*=\s*['"][^'"]*url=)([^'">\s]+)/gi,
             (m,p,v) => p + toProxyUrl(v))
    // base tag رو خنثی کن
    .replace(/<base[^>]*>/gi, '');
}

function rewriteCss(css, baseUrl, proxyBase, passParam) {
  const base = new URL(baseUrl);
  const pp   = passParam ? `?__pp=${encodeURIComponent(passParam)}` : "";
  return css.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (m, q, v) => {
    if (!v || v.startsWith("data:")) return m;
    try {
      const abs = new URL(v, base).href;
      return `url(${q}${proxyBase}${abs}${pp}${q})`;
    } catch { return m; }
  });
}

// ── main handler ──────────────────────────────────────────────────────────────
export default async function handler(req) {
  const url     = new URL(req.url);
  const path    = url.pathname;
  const origin  = url.origin;  // https://your-app.vercel.app
  const proxyBase = origin + PROXY_PATH;

  // صفحه اصلی
  if (path === "/" || path === "") {
    return new Response(HOME_HTML, {
      headers: { "content-type": "text/html; charset=utf-8" }
    });
  }

  // فقط مسیرهای /proxy/... رو handle کن
  if (!path.startsWith(PROXY_PATH)) {
    return Response.redirect(origin + "/", 302);
  }

  // استخراج target URL
  const rawTarget = path.slice(PROXY_PATH.length) + (url.search || "");
  if (!rawTarget) return Response.redirect(origin + "/", 302);

  // بررسی رمز عبور
  let passParam = url.searchParams.get("__pp") || "";
  if (PASSWORD) {
    if (passParam !== PASSWORD) {
      return Response.redirect(origin + "/", 302);
    }
  }

  // ساخت target URL
  let targetUrl;
  try {
    // حذف __pp از query string قبل از forward
    const tUrl = new URL(rawTarget.startsWith("http") ? rawTarget : "https://" + rawTarget);
    tUrl.searchParams.delete("__pp");
    targetUrl = tUrl.href;
  } catch {
    return new Response("Bad URL", { status: 400 });
  }

  // ساخت هدرهای forward
  const outHeaders = new Headers();
  for (const [k, v] of req.headers) {
    if (STRIP_REQ.has(k)) continue;
    if (k.startsWith("x-vercel-")) continue;
    outHeaders.set(k, v);
  }
  outHeaders.set("host", new URL(targetUrl).host);

  // حذف Accept-Encoding تا بتونیم HTML رو rewrite کنیم
  outHeaders.delete("accept-encoding");

  const method  = req.method;
  const hasBody = method !== "GET" && method !== "HEAD";

  let upstream;
  try {
    upstream = await fetch(targetUrl, {
      method,
      headers: outHeaders,
      body: hasBody ? req.body : undefined,
      redirect: "follow",
    });
  } catch (err) {
    return new Response(
      `<h2 style="font-family:sans-serif;color:#e53e3e">خطا در اتصال</h2><pre>${err.message}</pre>`,
      { status: 502, headers: { "content-type": "text/html; charset=utf-8" } }
    );
  }

  // handle redirect دستی
  const finalUrl = upstream.url || targetUrl;

  // ساخت response headers
  const resHeaders = new Headers();
  for (const [k, v] of upstream.headers) {
    if (STRIP_RES.has(k)) continue;
    resHeaders.set(k, v);
  }
  // اجازه embedding
  resHeaders.delete("x-frame-options");
  resHeaders.delete("content-security-policy");

  const ct = (upstream.headers.get("content-type") || "").toLowerCase();

  // برای HTML: rewrite لینک‌ها
  if (ct.includes("text/html")) {
    const text   = await upstream.text();
    const pp     = passParam;
    const rewritten = rewriteHtml(text, finalUrl, proxyBase, pp);
    resHeaders.set("content-type", "text/html; charset=utf-8");
    resHeaders.delete("content-length");
    return new Response(rewritten, {
      status: upstream.status,
      headers: resHeaders,
    });
  }

  // برای CSS: rewrite url()
  if (ct.includes("text/css")) {
    const text   = await upstream.text();
    const pp     = passParam;
    const rewritten = rewriteCss(text, finalUrl, proxyBase, pp);
    resHeaders.set("content-type", "text/css; charset=utf-8");
    resHeaders.delete("content-length");
    return new Response(rewritten, {
      status: upstream.status,
      headers: resHeaders,
    });
  }

  // بقیه (عکس، ویدیو، JS، JSON، ...) → مستقیم stream
  return new Response(upstream.body, {
    status: upstream.status,
    headers: resHeaders,
  });
}
