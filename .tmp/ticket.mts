const BASE = 'http://localhost:3000';
const pageId = process.argv[2];
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'demo@collabspace.dev', password: 'Demo1234!' }),
});
const cookie = (login.headers.getSetCookie() ?? []).map(c => c.split(';')[0]).join('; ');
const res = await fetch(`${BASE}/api/pages/${pageId}/ticket`, { headers: { cookie } });
const { ticket, role } = await res.json();
console.log(`${ticket} ${role}`);
