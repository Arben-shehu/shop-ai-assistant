// ---------------------------------------------------------------------------
// Patch 3: WhatsApp Web 2026-07 renamed the `_serialized` getter to `$1` on
// MsgKey/Wid objects. whatsapp-web.js 1.34.7 reads `newMsgKey._serialized`
// after a send, gets `undefined`, and `Msg.get(undefined)` returns undefined —
// so every send reported no model (messageId: null) even though the message
// was delivered. Same rename breaks message ids on incoming events/acks.
//
// Fix (ported from WAHA 2026.7.2, verified locally on a linked session
// 2026-07-31): a `GetSerialized` helper that uses `_serialized` when present
// and otherwise RECONSTRUCTS it from the object's own components
// (Wid: user[:device]@server, MsgKey: fromMe_remote_id[_self][_participant]),
// caching the result back onto the object. Applied at 4 sites:
//   1. sendMessage return      → real messageId comes back
//   2. editMessage return      → same
//   3. getMessageModel         → incoming messages/acks carry `_serialized`
//   4. getChatModel createWid  → future-proof (chat Wids still work today)
//
// Runs at image build time against the installed library. Every anchor is
// guarded: a missing anchor fails the build loudly instead of shipping a
// half-patched image.
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync } from 'node:fs';

const FILE =
    process.env.PATCH_TARGET ??
    '/app/node_modules/whatsapp-web.js/src/util/Injected/Utils.js';

const HELPERS = `
    // ── GetSerialized (WAHA-style): WA Web 2026-07 renamed _serialized → $1 ──
    const _cachedSerialized = (id) => {
        if (id == null) return { done: true, value: id };
        if (typeof id === 'string') return { done: true, value: id };
        if (typeof id._serialized === 'string' && id._serialized !== '') {
            return { done: true, value: id._serialized };
        }
        return { done: false, value: null };
    };
    window.WWebJS.GetSerializedWid = (id) => {
        const hit = _cachedSerialized(id);
        if (hit.done) return hit.value;
        let value;
        if (id.user != null && id.server != null) {
            value = id.user === 'call'
                ? 'call'
                : id.user + (id.device ? ':' + id.device : '') + '@' + id.server;
        } else {
            value = null;
        }
        if (value != null) id._serialized = value;
        return value;
    };
    window.WWebJS.GetSerializedMsgKey = (id) => {
        const hit = _cachedSerialized(id);
        if (hit.done) return hit.value;
        let value;
        if (id.remote != null && id.id != null) {
            const remote = window.WWebJS.GetSerializedWid(id.remote);
            const participant = id.participant != null
                ? window.WWebJS.GetSerializedWid(id.participant)
                : null;
            value = (id.fromMe ? 'true' : 'false') + '_' + remote + '_' + id.id
                + (id.self ? '_' + id.self : '')
                + (participant ? '_' + participant : '');
        } else {
            value = null;
        }
        if (value != null) id._serialized = value;
        return value;
    };
    window.WWebJS.GetSerialized = (id) => {
        const hit = _cachedSerialized(id);
        if (hit.done) return hit.value;
        if (id.remote != null && id.id != null) return window.WWebJS.GetSerializedMsgKey(id);
        if (id.user != null && id.server != null) return window.WWebJS.GetSerializedWid(id);
        return null;
    };
`;

// [anchor that must exist exactly once, replacement]
const EDITS = [
    // 0. Helpers, injected right after the WWebJS namespace is created.
    ['window.WWebJS = {};', 'window.WWebJS = {};' + HELPERS],
    // 1. sendMessage: look the sent message up by a reconstructed key.
    [
        '.Msg.get(newMsgKey._serialized);',
        '.Msg.get(window.WWebJS.GetSerialized(newMsgKey));',
    ],
    // 2. editMessage: same lookup after an edit.
    [
        ".Msg.get(msg.id._serialized);",
        '.Msg.get(window.WWebJS.GetSerialized(msg.id));',
    ],
    // 3. getMessageModel: materialize `_serialized` (and a string `remote`) on
    //    every model shipped to the Node side — incoming messages and acks.
    [
        'delete msg.pendingAckUpdate;',
        "if (typeof msg.id.remote === 'object') {\n" +
            '            msg.id = Object.assign({}, msg.id, {\n' +
            '                remote: window.WWebJS.GetSerialized(msg.id.remote),\n' +
            '            });\n' +
            '        }\n' +
            '        window.WWebJS.GetSerialized(msg.id);\n' +
            '        delete msg.pendingAckUpdate;',
    ],
    // 4. getChatModel: build the Wid from a reconstructed id string.
    [
        'createWid(chat.id._serialized);',
        'createWid(window.WWebJS.GetSerialized(chat.id));',
    ],
];

let src = readFileSync(FILE, 'utf8');
for (const [anchor, replacement] of EDITS) {
    const count = src.split(anchor).length - 1;
    if (count !== 1) {
        console.error(`FAIL: anchor found ${count}x (expected 1): ${anchor}`);
        process.exit(1);
    }
    src = src.replace(anchor, replacement);
}
writeFileSync(FILE, src);

// Post-conditions: helper present, no unguarded key reads left at the 3 sites.
const patched = readFileSync(FILE, 'utf8');
for (const must of ['GetSerializedMsgKey', 'GetSerialized(newMsgKey)']) {
    if (!patched.includes(must)) {
        console.error(`FAIL: post-check missing: ${must}`);
        process.exit(1);
    }
}
console.log(`getserialized patch OK → ${FILE}`);
