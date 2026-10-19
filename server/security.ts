import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
const equal = (a:string,b:string) => Buffer.byteLength(a)===Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function localSecurity(port: number) {
  const sessions = new Map<string,string>();
  const allowed = new Set([`127.0.0.1:${port}`,`localhost:${port}`]);
  const guard: RequestHandler = (req,res,next) => {
    if (!allowed.has(req.headers.host || '')) {res.status(403).json({error:'Freewheel only accepts local requests.'});return;}
    const origin = req.headers.origin;
    if (origin && ![...allowed].some(host=>origin===`http://${host}`)) {res.status(403).json({error:'Origin rejected.'});return;}
    if (req.headers['sec-fetch-site']==='cross-site') {res.status(403).json({error:'Cross-site request rejected.'});return;}
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    if (req.path.startsWith('/api')) res.setHeader('Cache-Control','no-store');
    next();
  };
  const session: RequestHandler = (req,res,next) => {
    const cookie = req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('freewheel='))?.slice(10) || '';
    let csrf = sessions.get(cookie);
    if (req.path === '/bootstrap' && req.method === 'GET') {
      if (!csrf) {
        const id = randomBytes(32).toString('hex'); csrf = randomBytes(32).toString('hex');
        if(sessions.size>=32) sessions.delete(sessions.keys().next().value!);
        sessions.set(id,csrf); res.setHeader('Set-Cookie',`freewheel=${id}; HttpOnly; SameSite=Strict; Path=/`);
      }
      res.locals.csrf = csrf; next(); return;
    }
    if (!csrf) {res.status(401).json({error:'Reload Freewheel to reconnect.'});return;}
    if (!['GET','HEAD'].includes(req.method) && !equal(String(req.headers['x-freewheel-csrf'] || ''),csrf)) {res.status(403).json({error:'Session verification failed. Reload Freewheel.'});return;}
    next();
  };
  return {guard,session};
}
