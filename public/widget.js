/*!
 * Web chat widget. Embed on the shop's site:
 *   <script src="https://APP/widget.js" data-key="wk_..." async></script>
 * Optional attributes: data-title, data-greeting, data-color (#rgb / #rrggbb),
 *   data-whatsapp-text (prefilled text of the "Vazhdo në WhatsApp" link).
 * The WhatsApp number itself comes from the server (GET/POST .../session -> whatsapp), never from the page.
 * No dependencies. All message content is rendered with textContent (never innerHTML).
 */
(function () {
  "use strict";

  // Must be read synchronously: document.currentScript is null once this tick ends.
  var script =
    document.currentScript ||
    (function () {
      var list = document.querySelectorAll("script[src*='widget.js'][data-key]");
      return list[list.length - 1] || null;
    })();
  if (!script) return;

  var KEY = script.getAttribute("data-key") || "";
  if (!/^wk_[A-Za-z0-9_-]{32}$/.test(KEY)) {
    if (window.console) console.warn("[chat-widget] missing or invalid data-key");
    return;
  }
  window.__shopChatWidgets = window.__shopChatWidgets || {};
  if (window.__shopChatWidgets[KEY]) return; // double init guard
  window.__shopChatWidgets[KEY] = true;

  var API;
  try {
    API = new URL(script.src, location.href).origin + "/api/widget/" + encodeURIComponent(KEY);
  } catch {
    return;
  }

  var COLOR = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(script.getAttribute("data-color") || "")
    ? script.getAttribute("data-color")
    : "#2563eb";
  var L = {
    title: script.getAttribute("data-title") || "",
    greeting: script.getAttribute("data-greeting") || "Përshëndetje! Si mund t'ju ndihmojmë?",
    placeholder: "Shkruani mesazhin…",
    send: "Dërgo",
    open: "Hap bisedën",
    close: "Mbyll bisedën",
    defaultTitle: "Na shkruani",
    typing: "Po shkruan…",
    failed: "Mesazhi nuk u dërgua. Provoni përsëri.",
    tooFast: "Po dërgoni shumë shpejt. Prisni pak.",
    dailyLimit: "Chat-i është i zënë për momentin. Provoni më vonë.",
    unavailable: "Chat-i nuk është i disponueshëm.",
    tooLong: "Mesazhi është shumë i gjatë.",
    whatsapp: "Vazhdo në WhatsApp",
    whatsappText: (script.getAttribute("data-whatsapp-text") || "").trim().slice(0, 300) || "Përshëndetje! Ju shkruaj nga faqja juaj e internetit.",
  };
  var MAX_LEN = 1000;
  var POLL_OPEN_MS = 3000;
  var POLL_CLOSED_MS = 30000;

  // ---------------------------------------------------------------- storage (localStorage, else memory)
  var memory = {};
  function store(k, v) {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* private mode / blocked storage */
    }
    if (v === null) delete memory[k];
    else memory[k] = v;
  }
  function load(k) {
    try {
      var v = localStorage.getItem(k);
      if (v !== null) return v;
    } catch {
      /* ignore */
    }
    return Object.prototype.hasOwnProperty.call(memory, k) ? memory[k] : null;
  }
  var TOKEN_KEY = "shopchat:" + KEY + ":token";
  var SEEN_KEY = "shopchat:" + KEY + ":seen";

  // ---------------------------------------------------------------- state
  var token = load(TOKEN_KEY);
  var cursor = null;
  var messages = []; // { id, ref, sender, text, createdAt, local, failed }
  var seenIds = {};
  var isOpen = false;
  var typing = false;
  var disabled = false;
  var pollTimer = null;
  var polling = false;
  var lastSeen = load(SEEN_KEY) || "";
  var loadedOnce = false;
  var configLoaded = false;

  // ---------------------------------------------------------------- DOM
  var host = document.createElement("div");
  host.setAttribute("data-shop-chat", "");
  host.style.cssText = "position:fixed;z-index:2147483000;bottom:0;right:0;width:0;height:0;";
  var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;

  var style = document.createElement("style");
  style.textContent =
    ":host{all:initial}" +
    "*{box-sizing:border-box;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}" +
    ".bubble{position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;border:0;cursor:pointer;" +
    "background:var(--c);color:#fff;box-shadow:0 6px 20px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;padding:0}" +
    ".bubble:focus-visible,.send:focus-visible,.x:focus-visible{outline:3px solid rgba(0,0,0,.35);outline-offset:2px}" +
    ".bubble svg{width:28px;height:28px}" +
    ".badge{position:absolute;top:-2px;right:-2px;min-width:20px;height:20px;border-radius:10px;background:#dc2626;color:#fff;" +
    "font-size:12px;font-weight:600;display:none;align-items:center;justify-content:center;padding:0 5px}" +
    ".panel{position:fixed;right:20px;bottom:88px;width:360px;height:520px;max-height:calc(100vh - 108px);background:#fff;color:#111827;" +
    "border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.25);display:none;flex-direction:column;overflow:hidden}" +
    ".panel.open{display:flex}" +
    ".head{background:var(--c);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:8px}" +
    ".head .t{flex:1;font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".x{background:transparent;border:0;color:#fff;cursor:pointer;font-size:22px;line-height:1;padding:2px 6px;border-radius:6px}" +
    ".list{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;background:#f9fafb}" +
    ".m{max-width:82%;padding:8px 12px;border-radius:14px;font-size:14px;line-height:1.4;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere}" +
    ".m.in{align-self:flex-start;background:#fff;border:1px solid #e5e7eb;border-bottom-left-radius:4px}" +
    ".m.out{align-self:flex-end;background:var(--c);color:#fff;border-bottom-right-radius:4px}" +
    ".m.pending{opacity:.6}.m.failed{background:#fee2e2;color:#991b1b}" +
    ".note{align-self:center;font-size:12px;color:#6b7280;text-align:center;padding:2px 8px}" +
    ".typing{align-self:flex-start;font-size:12px;color:#6b7280;font-style:italic;display:none}" +
    ".form{display:flex;gap:8px;padding:10px;border-top:1px solid #e5e7eb;background:#fff}" +
    ".in-text{flex:1;resize:none;border:1px solid #d1d5db;border-radius:10px;padding:9px 10px;font-size:14px;max-height:96px;min-height:40px;color:#111827;background:#fff}" +
    ".in-text:focus{outline:2px solid var(--c);outline-offset:-1px;border-color:transparent}" +
    ".send{border:0;border-radius:10px;background:var(--c);color:#fff;font-size:14px;font-weight:600;padding:0 14px;cursor:pointer}" +
    ".send:disabled{opacity:.5;cursor:default}" +
    ".wa{display:none;align-items:center;justify-content:center;gap:8px;padding:9px 12px;border-top:1px solid #e5e7eb;" +
    "background:#f0fdf4;color:#166534;font-size:14px;font-weight:600;text-decoration:none;line-height:1.2}" +
    ".wa.show{display:flex}.wa:hover{background:#dcfce7}.wa:focus-visible{outline:3px solid rgba(0,0,0,.35);outline-offset:-3px}" +
    ".wa svg{width:20px;height:20px;flex:none}" +
    "@media (max-width:480px){.panel{right:0;bottom:0;width:100vw;height:100%;max-height:none;border-radius:0}" +
    ".panel.open~.bubble{display:none}.in-text{font-size:16px}}";
  root.appendChild(style);

  var wrap = document.createElement("div");
  wrap.style.setProperty("--c", COLOR);
  root.appendChild(wrap);

  var panel = el("div", "panel");
  panel.setAttribute("role", "dialog");
  var head = el("div", "head");
  var titleEl = el("div", "t");
  titleEl.textContent = L.title || L.defaultTitle;
  panel.setAttribute("aria-label", titleEl.textContent);
  var closeBtn = el("button", "x");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", L.close);
  closeBtn.textContent = "×";
  head.appendChild(titleEl);
  head.appendChild(closeBtn);

  var list = el("div", "list");
  list.setAttribute("aria-live", "polite");
  var typingEl = el("div", "typing");
  typingEl.textContent = L.typing;

  var form = el("form", "form");
  var input = el("textarea", "in-text");
  input.rows = 1;
  input.maxLength = MAX_LEN;
  input.placeholder = L.placeholder;
  input.setAttribute("aria-label", L.placeholder);
  var sendBtn = el("button", "send");
  sendBtn.type = "submit";
  sendBtn.textContent = L.send;
  form.appendChild(input);
  form.appendChild(sendBtn);

  // "Vazhdo në WhatsApp": hidden until the server returns our number.
  var waLink = el("a", "wa");
  waLink.target = "_blank";
  waLink.rel = "noopener noreferrer";
  waLink.appendChild(waIcon());
  var waLabel = el("span");
  waLabel.textContent = L.whatsapp;
  waLink.appendChild(waLabel);

  panel.appendChild(head);
  panel.appendChild(list);
  panel.appendChild(waLink);
  panel.appendChild(form);

  var bubble = el("button", "bubble");
  bubble.type = "button";
  bubble.setAttribute("aria-label", L.open);
  bubble.setAttribute("aria-expanded", "false");
  bubble.appendChild(chatIcon());
  var badge = el("span", "badge");
  bubble.appendChild(badge);

  wrap.appendChild(panel);
  wrap.appendChild(bubble);

  function el(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }
  function chatIcon() {
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    var p = document.createElementNS(ns, "path");
    p.setAttribute("d", "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z");
    svg.appendChild(p);
    return svg;
  }

  function waIcon() {
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    var p = document.createElementNS(ns, "path");
    p.setAttribute("fill", "#25D366");
    p.setAttribute("d", "M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z");
    svg.appendChild(p);
    var h = document.createElementNS(ns, "path");
    h.setAttribute("fill", "#fff");
    h.setAttribute(
      "d",
      "M9.2 7.2c-.2-.5-.4-.5-.6-.5h-.5c-.2 0-.5.1-.7.3-.2.3-.9.9-.9 2.2s.9 2.5 1 2.7c.1.2 1.8 2.9 4.5 4 " +
        "2.2.9 2.7.7 3.2.7.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.2-.2-.5-.3l-1.7-.8c-.2-.1-.4-.1-.6.1" +
        "l-.8 1c-.1.2-.3.2-.5.1-.3-.1-1.1-.4-2-1.3-.8-.7-1.3-1.5-1.4-1.8-.2-.3 0-.4.1-.5l.4-.4.2-.4v-.4l-.8-1.9z"
    );
    svg.appendChild(h);
    return svg;
  }

  /** Shows the WhatsApp link for a server-provided number (digits only), hides it otherwise. */
  function setWhatsApp(number) {
    if (typeof number === "string" && /^\d{8,15}$/.test(number)) {
      waLink.href = "https://wa.me/" + number + "?text=" + encodeURIComponent(L.whatsappText);
      waLink.classList.add("show");
    } else {
      waLink.removeAttribute("href");
      waLink.classList.remove("show");
    }
  }

  // ---------------------------------------------------------------- rendering
  function render() {
    while (list.firstChild) list.removeChild(list.firstChild);
    var greet = el("div", "m in");
    greet.textContent = L.greeting;
    list.appendChild(greet);
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      var mine = m.sender === "CUSTOMER";
      var d = el("div", "m " + (mine ? "out" : "in") + (m.local && !m.failed ? " pending" : "") + (m.failed ? " failed" : ""));
      d.textContent = m.text;
      if (m.failed) d.title = m.failed;
      list.appendChild(d);
      if (m.failed) {
        var n = el("div", "note");
        n.textContent = m.failed;
        list.appendChild(n);
      }
    }
    if (disabled) {
      var u = el("div", "note");
      u.textContent = L.unavailable;
      list.appendChild(u);
    }
    typingEl.style.display = typing && isOpen ? "block" : "none";
    list.appendChild(typingEl);
    list.scrollTop = list.scrollHeight;
    input.disabled = sendBtn.disabled = disabled;
    updateBadge();
  }

  function updateBadge() {
    var unread = 0;
    if (!isOpen) {
      for (var i = 0; i < messages.length; i++) {
        var m = messages[i];
        if (m.sender !== "CUSTOMER" && !m.local && m.createdAt > lastSeen) unread++;
      }
    }
    badge.textContent = unread > 9 ? "9+" : String(unread);
    badge.style.display = unread ? "flex" : "none";
  }

  function markSeen() {
    for (var i = messages.length - 1; i >= 0; i--) {
      if (!messages[i].local) {
        if (messages[i].createdAt > lastSeen) {
          lastSeen = messages[i].createdAt;
          store(SEEN_KEY, lastSeen);
        }
        break;
      }
    }
  }

  function merge(incoming) {
    var changed = false;
    for (var i = 0; i < incoming.length; i++) {
      var m = incoming[i];
      if (seenIds[m.id]) continue;
      seenIds[m.id] = true;
      changed = true;
      var replaced = false;
      if (m.ref) {
        for (var j = 0; j < messages.length; j++) {
          if (messages[j].local && messages[j].ref === m.ref) {
            messages[j] = m;
            replaced = true;
            break;
          }
        }
      }
      if (!replaced) messages.push(m);
    }
    if (changed) {
      messages.sort(function (a, b) {
        if (a.local !== b.local) return a.local ? 1 : -1; // unconfirmed local messages stay last
        return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
      });
    }
    return changed;
  }

  // ---------------------------------------------------------------- network
  function request(method, path, body) {
    var headers = {};
    if (token) headers.Authorization = "Bearer " + token;
    if (body) headers["Content-Type"] = "application/json";
    return fetch(API + path, {
      method: method,
      headers: headers,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "omit",
      cache: "no-store",
    }).then(function (res) {
      return res
        .json()
        .catch(function () {
          return {};
        })
        .then(function (data) {
          return { status: res.status, data: data || {} };
        });
    });
  }

  function newSession() {
    return request("POST", "/session").then(function (r) {
      if (r.status !== 200 || !r.data.token) throw r;
      token = r.data.token;
      store(TOKEN_KEY, token);
      if (r.data.shop && !L.title) setTitle(r.data.shop);
      if ("whatsapp" in r.data) setWhatsApp(r.data.whatsapp);
      return token;
    });
  }

  // Token-less config (shop name + WhatsApp number), once per page load when the panel is first opened.
  function loadConfig() {
    if (configLoaded || disabled) return;
    configLoaded = true;
    fetch(API + "/session", { method: "GET", credentials: "omit", cache: "no-store" })
      .then(function (res) {
        if (handleUnavailable(res.status)) return null;
        return res.status === 200 ? res.json() : null;
      })
      .then(function (data) {
        if (!data) return;
        if (data.shop && !L.title) setTitle(data.shop);
        setWhatsApp(data.whatsapp);
      })
      .catch(function () {
        configLoaded = false; // offline: retry on the next open
      });
  }

  function setTitle(t) {
    titleEl.textContent = t;
    panel.setAttribute("aria-label", t);
  }

  function handleUnavailable(status) {
    if (status === 404 || status === 403) {
      disabled = true;
      setWhatsApp(null);
      stopPolling();
      render();
      return true;
    }
    return false;
  }

  function poll() {
    if (!token || polling || disabled) return Promise.resolve();
    polling = true;
    var q = cursor ? "?after=" + encodeURIComponent(cursor) : "";
    return request("GET", "/messages" + q)
      .then(function (r) {
        if (r.status === 401) {
          // Token no longer valid (e.g. server secret rotated): start over.
          token = null;
          store(TOKEN_KEY, null);
          return;
        }
        if (handleUnavailable(r.status) || r.status !== 200) return;
        if (r.data.shop && !L.title) setTitle(r.data.shop);
        if (r.data.cursor) cursor = r.data.cursor;
        var changed = merge(r.data.messages || []);
        var wasTyping = typing;
        typing = !!r.data.typing;
        if (isOpen) markSeen();
        if (changed || wasTyping !== typing || !loadedOnce) render();
        loadedOnce = true;
      })
      .catch(function () {
        /* offline: try again next tick */
      })
      .then(function () {
        polling = false;
      });
  }

  function schedule() {
    stopPolling();
    if (disabled) return;
    var delay = isOpen ? POLL_OPEN_MS : POLL_CLOSED_MS;
    pollTimer = setTimeout(function () {
      if (document.hidden || !token) return schedule();
      poll().then(schedule);
    }, delay);
  }
  function stopPolling() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
  }

  function send(text) {
    var local = { id: "local-" + Date.now(), ref: null, sender: "CUSTOMER", text: text, createdAt: "", local: true, failed: null };
    messages.push(local);
    render();
    var attempt = function (retry) {
      return (token ? Promise.resolve(token) : newSession())
        .then(function () {
          return request("POST", "/messages", { text: text });
        })
        .then(function (r) {
          if (r.status === 401 && retry) {
            token = null;
            store(TOKEN_KEY, null);
            return attempt(false);
          }
          if (r.status === 202) {
            local.ref = r.data.ref;
            typing = true;
            render();
            return poll();
          }
          if (handleUnavailable(r.status)) return;
          local.failed =
            r.data.error === "daily_limit" ? L.dailyLimit : r.status === 429 ? L.tooFast : r.status === 413 ? L.tooLong : L.failed;
          render();
        });
    };
    attempt(true).catch(function (r) {
      if (r && handleUnavailable(r.status)) return;
      local.failed = r && r.status === 429 ? L.tooFast : L.failed;
      render();
    });
  }

  // ---------------------------------------------------------------- events
  function setOpen(open) {
    isOpen = open;
    panel.classList.toggle("open", open);
    bubble.setAttribute("aria-expanded", String(open));
    bubble.setAttribute("aria-label", open ? L.close : L.open);
    if (open) {
      loadConfig();
      markSeen();
      render();
      setTimeout(function () {
        input.focus();
      }, 0);
      poll().then(schedule);
    } else {
      updateBadge();
      schedule();
    }
  }

  bubble.addEventListener("click", function () {
    setOpen(!isOpen);
  });
  closeBtn.addEventListener("click", function () {
    setOpen(false);
    bubble.focus();
  });
  panel.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      setOpen(false);
      bubble.focus();
    }
  });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text || disabled) return;
    if (text.length > MAX_LEN) text = text.slice(0, MAX_LEN);
    input.value = "";
    autosize();
    send(text);
  });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (form.requestSubmit) form.requestSubmit();
      else form.dispatchEvent(new Event("submit", { cancelable: true }));
    }
  });
  function autosize() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 96) + "px";
  }
  input.addEventListener("input", autosize);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && token && !disabled) poll();
  });

  // ---------------------------------------------------------------- mount
  function mount() {
    document.body.appendChild(host);
    render();
    if (token) poll().then(schedule); // history + unread badge for returning visitors
  }
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();
