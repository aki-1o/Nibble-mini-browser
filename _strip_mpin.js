const fs = require('fs');
let L = fs.readFileSync('api-panel.js', 'utf8').split('\n');
const orig = L.length;
let n = 0;
const rm = (s, e, why) => {
  if (s < 0 || e >= L.length || s > e) throw new Error('BAD RANGE ' + why + ' ' + s + '..' + e);
  L.splice(s, e - s + 1);
  n += e - s + 1;
  console.log('removed ' + why + ': lines ' + (s + 1) + '..' + (e + 1));
};
const idx = (p, from = 0) => L.findIndex((l, i) => i >= from && p.test(l));
const exact = (t, from = 0) => L.findIndex((l, i) => i >= from && l === t);
const blockEnd = (s) => {
  let d = 0;
  for (let i = s; i < L.length; i++) {
    const stripped = L[i].replace(/\/\/.*$/, '');
    for (const c of stripped) { if (c === '{') d++; if (c === '}') d--; }
    if (d === 0) return i;
  }
  throw new Error('unbalanced from ' + s);
};

// 1. dead listeners (4 lines)
let a = idx(/createMpinBtn\.addEventListener\('click', createMpin\)/);
if (!L[a + 1].includes('changeMpinBtn')) throw new Error('listener block mismatch');
rm(a, a + 3, '4 dead listeners');

// 2. createMpin .. submitChallengeResponse functions (up to sendBtn listener)
const sendL = "  sendBtn.addEventListener('click', send);";
let f0 = idx(/^  async function createMpin\(\) \{$/);
let f1 = exact(sendL) - 1;
while (L[f1].trim() === '') f1--;
const chunk = L.slice(f0, f1 + 1).join('\n');
for (const m of ['async function changeMpin', 'async function validateMobile', 'async function submitChallengeResponse'])
  if (!chunk.includes(m)) throw new Error('fn block missing ' + m);
rm(f0, f1, 'createMpin..submitChallengeResponse');

// 3. register token-capture block: anchor on its unique const line, scan up to the if
let tc = idx(/const token = s >= 200/);
let t = tc;
while (t >= 0 && !/if \(registerRequest\) \{$/.test(L[t])) t--;
if (t < 0 || !L[tc + 1].includes('mpinEnabled')) throw new Error('token block mismatch');
rm(t, blockEnd(t), 'register token-capture block');

// 4. register error block (indented 6 spaces, unique content)
let e0 = idx(/^      if \(registerRequest\) \{$/);
if (!L[e0 + 1].includes("updateRegisterActions('', '')")) throw new Error('error block mismatch');
rm(e0, blockEnd(e0), 'register error block');

// 5. bearer auto-attach inside account-discovery headers
let u = idx(/if \(registerContext && registerContext\.token\)/);
rm(u, blockEnd(u), 'bearer auto-attach');

// 6. register deviceId header-guard block (unique message)
let d0 = idx(/Register request not sent/);
while (d0 >= 0 && !/^    if \(registerRequest\) \{$/.test(L[d0])) d0--;
if (d0 < 0) throw new Error('deviceId block mismatch');
let d1 = blockEnd(d0);
rm(d0, L[d1 + 1].trim() === '' ? d1 + 1 : d1, 'register deviceId block');

// 7. header line: drop registerRequest condition
let k = idx(/headers\['X-API-KEY'\] = keyVal/);
if (!L[k].includes('registerRequest')) throw new Error('header line mismatch');
L[k] = L[k].replace('if (registerRequest || isAccountDiscovery)', 'if (isAccountDiscovery)');
console.log('patched header line ' + (k + 1));

// 8. registerRequest decl + waiting-status block
let r = idx(/const registerRequest = isRegisterUrl\(url\);/);
if (L[r + 1].trim() !== 'if (registerRequest) {') throw new Error('pre-send block mismatch');
let r1 = blockEnd(r + 1);
rm(r, L[r1 + 1].trim() === '' ? r1 + 1 : r1, 'registerRequest decl + waiting block');

// 9. getBrowserDeviceDetails (only used by createMpin)
let g = idx(/^  function getBrowserDeviceDetails\(\) \{$/);
let ge = exact("  resPre.addEventListener('scroll', () => { resGutter.scrollTop = resPre.scrollTop; });", g) - 1;
while (L[ge].trim() === '') ge--;
rm(g, ge, 'getBrowserDeviceDetails');

// 10. isRegisterUrl .. updateRegisterActions helpers (up to showBody)
let h = idx(/^  function isRegisterUrl\(value\) \{$/);
let he = exact('  function showBody(text, asJson) {', h) - 1;
while (L[he].trim() === '') he--;
const hchunk = L.slice(h, he + 1).join('\n');
for (const m of ['findAccessToken', 'findRefreshToken', 'updateRegisterActions'])
  if (!hchunk.includes(m)) throw new Error('helper block missing ' + m);
rm(h, he, 'isRegisterUrl..updateRegisterActions');

// 11. context lets
L = L.filter(l => !/^  let (registerContext|mobileValidationContext) = null;$/.test(l));
console.log('removed context lets');

// 12. optEl comment + helper + 14 stub refs
let o = idx(/The MPIN \/ Change-MPIN/);
let oe = idx(/const challengeResponseBtn = optEl/);
rm(o, oe, 'optEl block');

// 13. MPIN error-table entry
let v = idx(/2103/);
if (!L[v].includes('MPIN already exists')) throw new Error('2103 mismatch');
rm(v, v, '2103 error entry');

let out = L.join('\n').replace(/\n{3,}/g, '\n\n');
fs.writeFileSync('api-panel.js', out);
console.log('lines ' + orig + ' -> ' + out.split('\n').length + ' (' + n + ' removed)');
