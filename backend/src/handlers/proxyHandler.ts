import { authenticate, optionalAuth } from '../middleware/auth';
import { safeFetch, resolveSafeWsUrl, type SafeWsTarget } from '../utils/ssrf';
import WebSocket from 'ws';
import { AppDataSource } from '../config/typeorm';
import { Node } from '../models/node.entity';
import { TunnelDevice } from '../models/tunnelDevice.entity';
import { TunnelAllocation } from '../models/tunnelAllocation.entity';
import { Not, IsNull } from 'typeorm';

const SITES: Record<string, string> = { chunkbase: 'https://www.chunkbase.com', mcseedmap: 'https://mcseedmap.net' };
const AD = /ads\.adthrive\.com|pagead2\.googlesyndication\.com|doubleclick\.net|googletagmanager\.com|google-analytics\.com|googletagservices\.com|adnxs\.com|rubiconproject\.com|criteo\.com|amazon-adsystem\.com|pubmatic\.com|openx\.net|moatads\.com|scorecardresearch\.com|quantserve\.com|outbrain\.com|taboola\.com|yandex\.ru\/ads/i;

function allowedPanelOrigins(): string[] {
  const raw = [process.env.BACKEND_URL, process.env.PANEL_URL, ...(process.env.FRONTEND_URL || '').split(',')];
  const out: string[] = [];
  for (const u of raw) {
    if (!u) continue;
    try { out.push(new URL(u).origin); } catch { /* ignorance is tollerance */ }
  }
  return out;
}

function isAllowedProxyOrigin(origin: string | null | undefined, requestHost?: string, siteOrigin?: string): boolean {
  if (!origin) return false;
  try {
    const o = new URL(origin);
    if (requestHost && o.host === requestHost) return true;
    if (allowedPanelOrigins().includes(o.origin)) return true;
    if (siteOrigin) {
      try { if (o.origin === new URL(siteOrigin).origin) return true; } catch {}
    }
    return false;
  } catch {
    return false;
  }
}

function isProxySiteToken(payload: any): string | null {
  if (!payload || payload.scope !== 'proxy') return null;
  if (typeof payload.site !== 'string' || !SITES[payload.site]) return null;
  return SITES[payload.site];
}

export function proxyRoutes(app: any, prefix: string) {
  app.get(prefix + '/internal-domains', async (ctx: any) => {
    const domains = new Set<string>();
    const origins = new Set<string>();
    const addOrigin = (host: string, port?: string) => {
      const raw = String(host || '').trim().replace(/^https?:\/\//i, '').split('/')[0].split('?')[0];
      if (!raw) return;
      const hostname = raw.includes(':') && !raw.startsWith('[') && (raw.match(/:/g) || []).length === 1
        ? raw.split(':')[0]
        : raw;
      domains.add(hostname);
      origins.add(port ? `${hostname}:${port}` : raw);
    };
    try {
      const backendUrl = process.env.BACKEND_URL || '';
      if (backendUrl) { try { addOrigin(new URL(backendUrl).hostname); } catch { } }
    } catch { }
    try {
      if (ctx.request?.headers?.get) {
        const host = (ctx.request.headers.get('host') || '').split(':')[0];
        if (host) addOrigin(host);
      }
    } catch { }
    try {
      const nodes = await AppDataSource.getRepository(Node).find({ select: { url: true, backendWingsUrl: true, fqdn: true, proxmoxHost: true } });
      for (const node of nodes) {
        let nodePort: string | undefined;
        for (const raw of [node.url, node.backendWingsUrl]) {
          if (!raw) continue;
          try {
            const u = new URL(raw);
            nodePort = u.port || undefined;
            addOrigin(u.hostname, nodePort);
          } catch {
            addOrigin(raw);
          }
        }
        if (node.fqdn) addOrigin(node.fqdn, nodePort);
        if (node.proxmoxHost) addOrigin(node.proxmoxHost);
      }
    } catch { }
    try {
      const devices = await AppDataSource.getRepository(TunnelDevice).find({ select: { fqdn: true }, where: { kind: 'server', fqdn: Not(IsNull()) } });
      for (const d of devices) { if (d.fqdn) addOrigin(d.fqdn); }
    } catch { }
    try {
      const allocs = await AppDataSource.getRepository(TunnelAllocation)
        .createQueryBuilder('alloc').select('DISTINCT alloc.host', 'host').where('alloc.status = :status', { status: 'active' }).getRawMany();
      for (const a of allocs) { if (a.host) addOrigin(a.host); }
    } catch { }
    return { domains: Array.from(domains).sort(), origins: Array.from(origins).sort() };
  }, { detail: { tags: ['Proxy'], summary: 'List trusted internal domains' } });

  app.get(prefix + '/proxy/image', async (ctx: any) => {
    const rawUrl = ctx.query.url;
    if (!rawUrl || typeof rawUrl !== 'string') { ctx.set.status = 400; return { error: ctx.t('proxy.missing_url_parameter') }; }
    let remoteRes: Response | null = null;
    try {
      remoteRes = await safeFetch(rawUrl, {
        headers: { 'User-Agent': 'EcliPanel-ImageProxy/3.0', 'Accept': 'image/*' },
        signal: AbortSignal.timeout(15000),
      });
    } catch { remoteRes = null; }
    if (!remoteRes) { ctx.set.status = 403; return { error: ctx.t('proxy.internal_private_host_not_allowed') }; }
    if (!remoteRes.ok) { ctx.set.status = 502; return { error: `Upstream returned ${remoteRes.status}` }; }
    const contentType = remoteRes.headers.get('content-type') || 'application/octet-stream';
    if (!contentType.startsWith('image/')) { ctx.set.status = 400; return { error: ctx.t('proxy.url_does_not_point_to_an_image') }; }
    const contentLength = remoteRes.headers.get('content-length');
    const imgBytes = new Uint8Array(await remoteRes.arrayBuffer());
    if (imgBytes.byteLength > 50 * 1024 * 1024) { ctx.set.status = 400; return { error: ctx.t('proxy.image_too_large_max_50mb') }; }
    const headers: Record<string, string> = { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' };
    if (contentLength) headers['Content-Length'] = contentLength;
    return new Response(imgBytes, { status: 200, headers });
  }, { beforeHandle: [optionalAuth], detail: { tags: ['Proxy'], summary: 'Proxy an external image', description: 'Fetches an image from url param and serves it through the panel' } });

  app.all(prefix + '/proxy/external', async (ctx: any) => {
    const url = ctx.query.url;
    if (!url || typeof url !== 'string') { ctx.set.status = 400; return { error: 'Missing url param' }; }
    let authorized = !!ctx.user;
    const t = ctx.query.t;
    if (!authorized && t && typeof t === 'string') {
      try {
        const payload = app.jwt.verify(t) as any;
        if (payload && payload.scope === 'proxy') authorized = true;
      } catch { }
    }
    if (!authorized) { ctx.set.status = 401; return { error: 'Unauthorized' }; }

    const accept = ctx.request?.headers?.get?.('accept') || '';
    const isStreaming = accept.includes('text/event-stream');

    let upstream: Response | null = null;
    try {
      const init: RequestInit = {
        method: ctx.request.method || 'GET',
        headers: { 'User-Agent': 'EcliPanel-Proxy/3.0', 'Accept': '*/*' },
      };
      if (ctx.request.method && ctx.request.method !== 'GET' && ctx.request.method !== 'HEAD') {
        const ct = ctx.request.headers?.get?.('content-type');
        if (ct) (init.headers as Record<string, string>)['Content-Type'] = ct;
        const body = await ctx.request.arrayBuffer().catch(() => new ArrayBuffer(0));
        if (body.byteLength) init.body = body;
      }
      if (!isStreaming) (init as any).signal = AbortSignal.timeout(15000);
      upstream = await safeFetch(url, init);
    } catch { upstream = null; }
    if (!upstream) { ctx.set.status = 403; return { error: 'Host not allowed' }; }
    const ct = upstream.headers.get('content-type') || 'application/octet-stream';
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': ct,
        'Cache-Control': isStreaming ? 'no-cache' : 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        ...proxyCorsHeaders(ctx),
      },
    });
  }, { beforeHandle: [optionalAuth], detail: { tags: ['Proxy'], summary: 'Generic external URL proxy' } });

  const makeProxyJS = (proxyPath: string, siteOrigin: string, token: string, externalPath: string): string => {
    const siteHost = (() => { try { return new URL(siteOrigin).hostname; } catch { return ''; } })();
    const backendPublic = (process.env.BACKEND_URL || '').replace(/\/+$/, '');
    const wsHost = /^https?:\/\//.test(backendPublic) ? backendPublic.replace(/^http/, 'ws') : '';
    return `<script data-panel-proxy>
(function(){
  'use strict';
  var P='${proxyPath}', E='${externalPath}', T='${token}', O='${siteOrigin}', SH='${siteHost}';
  var WS_HOST='${wsHost}';
  var WS_BASE=(WS_HOST?WS_HOST:(location.protocol==='https:'?'wss://':'ws://')+location.host)+'/api/proxy/ws?t='+T+'&url=';

  var isAd = function(u){return typeof u==='string'&&${AD.toString()}.test(u);};
  var skip = function(u){return typeof u!=='string'||u.indexOf('blob:')===0||u.indexOf('data:')===0||u.indexOf('javascript:')===0||/^\\/?api\\/proxy\\//.test(u)?u:null;};

  var fix = function(u){
    var s=skip(u); if(s!==null)return s;
    if(isAd(u))return'about:blank';

    if(/^\\/\\//.test(u)){
      u='https:'+u;
      try{var h=new URL(u).hostname;if(h===SH)return P+new URL(u).pathname+new URL(u).search+new URL(u).hash;}catch(e){}
      return E+encodeURIComponent(u)+'&t='+T;
    }
    if(/^https?:\\/\\//.test(u)){
      try{var h2=new URL(u).hostname;if(h2===SH)return P+new URL(u).pathname+new URL(u).search+new URL(u).hash;}catch(e){}
      return E+encodeURIComponent(u)+'&t='+T;
    }
    if(u.indexOf('/')===0) return P+u;
    return u;
  };

  var _f=fetch;
  window.fetch=function(u,i){
    if(typeof u==='string')return _f.call(this,fix(u),i);
    if(u instanceof Request)return _f.call(this,new Request(fix(u.url),u),i);
    return _f.call(this,u,i);
  };

  var _o=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(m,u){return _o.call(this,m,fix(u));};

  var _ES=EventSource;
  window.EventSource=function(u,c){return new _ES(fix(u),c);};
  window.EventSource.prototype=_ES.prototype;

  var wsTarget=function(u){
    if(/^\\/\\//.test(u))u='https:'+u;
    if(/^(https?|wss?):\\/\\//.test(u)){
      try{var h=new URL(u).hostname;if(h===SH)return O+new URL(u).pathname+new URL(u).search;}catch(e){}
      return u;
    }
    if(u.indexOf('/')===0)return O+u;
    return O+'/'+u;
  };
  var _WS=WebSocket;
  window.WebSocket=function(u,p){
    var s=skip(u); if(s!==null)return new _WS(s,p);
    var target=wsTarget(u).replace(/^http/,'ws');
    return new _WS(WS_BASE+encodeURIComponent(target),p);
  };
  window.WebSocket.prototype=_WS.prototype;

  var _W=Worker;
  window.Worker=function(u,o){
    return new _W(fix(u),o);
  };
  window.Worker.prototype=_W.prototype;

  try{
    var _SW=SharedWorker;
    window.SharedWorker=function(u,o){
      return new _SW(fix(u),o);
    };
    window.SharedWorker.prototype=_SW.prototype;
  }catch(e){}

  var _I=Image;
  window.Image=function(w,h){
    var i=new _I(w,h);
    var d=Object.getOwnPropertyDescriptor(i.__proto__||_I.prototype,'src');
    if(d&&d.set){
      Object.defineProperty(i,'src',{
        set:function(v){if(!isAd(v))d.set.call(this,fix(v));},
        get:d.get,configurable:true
      });
    }
    return i;
  };

  var _c=document.createElement.bind(document);
  document.createElement=function(t){
    var e=_c(t);
    var tl=t.toLowerCase();
    if(tl==='script'||tl==='img'||tl==='iframe'||tl==='source'||tl==='embed'||tl==='video'||tl==='audio'){
      var sd=Object.getOwnPropertyDescriptor(e.__proto__||e.constructor.prototype,'src');
      if(sd&&sd.set){
        Object.defineProperty(e,'src',{
          set:function(v){if(!isAd(v))sd.set.call(this,fix(v));},
          get:sd.get,configurable:true
        });
      }
    }
    if(tl==='link'){
      var hd=Object.getOwnPropertyDescriptor(e.__proto__||e.constructor.prototype,'href');
      if(hd&&hd.set){
        Object.defineProperty(e,'href',{
          set:function(v){hd.set.call(this,fix(v));},
          get:hd.get,configurable:true
        });
      }
    }
    return e;
  };

  var _cssSet=CSSStyleDeclaration.prototype.setProperty;
  CSSStyleDeclaration.prototype.setProperty=function(prop,val,priority){
    if(typeof val==='string'&&/url\\s*\\(/.test(val)){
      val=val.replace(/url\\s*\\(\\s*['"]?([^'")\\s]+)['"]?\\s*\\)/gi,function(m,url){return'url('+fix(url)+')';});
    }
    return _cssSet.call(this,prop,val,priority);
  };

  var _open=window.open;
  window.open=function(u,t,f){return _open.call(window,fix(u),t,f);};
  try{var _la=location.assign.bind(location);location.assign=function(u){return _la(fix(u));};}catch(e){}
  try{var _lr=location.replace.bind(location);location.replace=function(u){return _lr(fix(u));};}catch(e){}
})();
</script>`;
  }

  app.all(prefix + '/proxy/web/:site/*', async (ctx: any) => {
    const site = (ctx.params.site || '') as string;
    const origin = SITES[site];
    if (!origin) { ctx.set.status = 404; return { error: 'Unknown proxy site: ' + site }; }

    const wildcard = ctx.params['*'] || '';
    const search = (() => { try { return new URL(ctx.request.url).search; } catch { return ''; } })();
    const target = origin + (wildcard ? '/' + wildcard : '') + search;
    const proxyPath = prefix + '/proxy/web/' + site;

    try {
      const reqBody =
        ctx.request.method && ctx.request.method !== 'GET' && ctx.request.method !== 'HEAD'
          ? await ctx.request.arrayBuffer().catch(() => new ArrayBuffer(0))
          : new ArrayBuffer(0);
      const reqCt = ctx.request.headers?.get?.('content-type') || '';
      const upstream = await fetch(target, {
        method: ctx.request.method || 'GET',
        headers: {
          'User-Agent': 'EcliPanel-WebProxy/3.0',
          'Accept': ctx.request.headers?.get?.('accept') || '*/*',
          'Referer': origin + '/',
          ...(reqCt ? { 'Content-Type': reqCt } : {}),
        },
        ...(reqBody.byteLength ? { body: reqBody } : {}),
        signal: AbortSignal.timeout(15000),
        redirect: 'follow'
      });
      const ct = upstream.headers.get('content-type') || '';

      let body = new Uint8Array(await upstream.arrayBuffer());

      if (ct.includes('text/html') || ct.includes('application/xhtml')) {
        let html = new TextDecoder().decode(body);
        html = html.replace(new RegExp('<script[^>]*\\b(?:' + AD.source + ')[^>]*>[\\s\\S]*?<\\/script>', 'gi'), '');

        const siteHost = (() => {
          try {
            const url = new URL(origin);
            if (!['http:', 'https:'].includes(url.protocol)) return '';
            const hostname = url.hostname.toLowerCase().trim();
            if (!hostname || hostname.includes(':') || url.port || url.username || url.password) {
              return '';
            }
            if (!hostname.includes('.') && hostname !== 'localhost') return '';
            return hostname;
          } catch {
            return '';
          }
        })();

        if (siteHost) {
          const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const siteRe = new RegExp('https?://' + esc(siteHost) + '(?=[/"\\s]|$)', 'gi');
          const protoRelativeRe = new RegExp('//(?=' + esc(siteHost) + '(?:[/"\\s]|$))', 'gi');
          html = html.replace(siteRe, proxyPath);
          html = html.replace(protoRelativeRe, proxyPath);
          html = html.replace(/srcset=["']([^"']+)["']/gi, (_m: string, urls: string) => {
            return 'srcset="' + urls.split(',').map((u: string) => {
              const trimmed = u.trim();
              return trimmed.replace(siteRe, proxyPath);
            }).join(', ') + '"';
          });
          html = html.replace(/(url\s*\(\s*['"]?)(\/\/[^'")\s]+|https?:\/\/[^'")\s]+)/gi, (_m: string, pre: string, u: string) => {
            const nu = u.startsWith('//') ? 'https:' + u : u;
            if (new RegExp('^https?://' + esc(siteHost) + '(?=[/"\\s]|$)').test(nu)) {
              return pre + proxyPath + nu.replace(new RegExp('^https?://' + esc(siteHost)), '');
            }
            return _m;
          });
        }
        const proxyToken = app.jwt.sign({ scope: 'proxy', site }, { expiresIn: '1h' });
        const baseTarget = (html.match(/<base[^>]*target\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
        html = html.replace(/<base[^>]*>/gi, '');

        const jsTag = makeProxyJS(proxyPath, origin, proxyToken, prefix + '/proxy/external?url=');
        const baseTag = `<base href="${proxyPath}/"${baseTarget ? ` target="${baseTarget}"` : ''}>`;

        if (html.includes('</head>')) {
          html = html.replace('</head>', baseTag + jsTag + '</head>');
        } else if (html.includes('<head>')) {
          html = html.replace('<head>', '<head>' + baseTag + jsTag);
        } else if (html.includes('<html>')) {
          html = html.replace('<html>', '<html><head>' + baseTag + jsTag + '</head>');
        } else {
          html = baseTag + jsTag + html;
        }

        body = new TextEncoder().encode(html);
      }

      const responseHeaders: Record<string, string> = {
        'Content-Type': ct || 'application/octet-stream',
        'Cache-Control': 'public, max-age=300',
        'X-Frame-Options': 'SAMEORIGIN',
        ...proxyCorsHeaders(ctx),
      };

      return new Response(body, { status: upstream.status, headers: responseHeaders });
    } catch (err) {
      ctx.set.status = 502;
      return { error: 'Proxy error: ' + (err instanceof Error ? err.message : String(err)) };
    }
  }, { beforeHandle: [optionalAuth], detail: { tags: ['Proxy'], summary: 'Web proxy with JS injection' } });

  app.all(prefix + '/proxy/chunkbase/*', async (ctx: any) => {
    const wildcard = ctx.params['*'] || '';
    const search = (() => { try { return new URL(ctx.request.url).search; } catch { return ''; } })();
    return Response.redirect(prefix + '/proxy/web/chunkbase/' + wildcard + search, 301);
  }, { beforeHandle: [optionalAuth], detail: { tags: ['Proxy'], summary: 'Redirect old chunkbase proxy' } });

  app.ws(prefix + '/proxy/ws', {
    beforeHandle: [optionalAuth],
    open(...args: any[]) {
      const { ctx, ws } = unwrapWsArgs(arguments);
      if (!ws) return;
      new ExternalWsProxySession(app, ctx, ws);
    },
    message(...args: any[]) {
      const { ws, message } = unwrapWsArgs(arguments);
      const session = ws?.data?._ecliWsProxy as ExternalWsProxySession | undefined;
      if (session) session.onClientMessage(message);
    },
    close(...args: any[]) {
      const { ws } = unwrapWsArgs(arguments);
      const session = ws?.data?._ecliWsProxy as ExternalWsProxySession | undefined;
      if (session) session.onClientClose();
    },
    error(...args: any[]) {
      const { ws } = unwrapWsArgs(arguments);
      const session = ws?.data?._ecliWsProxy as ExternalWsProxySession | undefined;
      if (session) session.onClientError();
    },
  });
}

function proxyCorsHeaders(ctx: any): Record<string, string> {
  const origin = ctx.request?.headers?.get?.('origin') || '';
  const host = ctx.request?.headers?.get?.('host') || '';
  if (origin && isAllowedProxyOrigin(origin, host)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin, X-CSRF-Token',
      'Vary': 'Origin',
    };
  }
  return {};
}

function unwrapWsArgs(args: IArguments | any[]) {
  const arr = Array.from(args);
  const len = arr.length;
  if (len === 1) {
    const ws = arr[0];
    return { ctx: ws?.data || {}, ws, message: undefined };
  }
  if (len === 2) {
    const [a, b] = arr;
    if (a?.params) return { ctx: a, ws: b, message: undefined };
    if (typeof a?.send === 'function') return { ctx: a?.data || {}, ws: a, message: b };
    return { ctx: a, ws: b, message: undefined };
  }
  if (len >= 3) return { ctx: arr[0], ws: arr[1], message: arr[2] };
  return { ctx: undefined, ws: undefined, message: undefined };
}

const MAX_PROXY_WS_SESSIONS = 200;
const PROXY_WS_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
let proxyWsSessionCount = 0;

class ExternalWsProxySession {
  private clientWs: any;
  private app: any;
  private upstreamWs: WebSocket | null = null;
  private destroyed = false;
  private idleTimer: any = null;

  constructor(app: any, ctx: any, ws: any) {
    this.app = app;
    this.clientWs = ws;
    ws.data._ecliWsProxy = this;

    if (proxyWsSessionCount >= MAX_PROXY_WS_SESSIONS) {
      this.reject(4404, 'Too many connections');
      return;
    }
    proxyWsSessionCount++;
    this.resetIdleTimer();

    let authorized = !!ctx?.user;
    const t = ctx?.query?.t;
    if (!authorized && t && typeof t === 'string') {
      try {
        const payload = app.jwt.verify(t) as any;
        const siteOrigin = isProxySiteToken(payload);
        if (siteOrigin) {
          const origin = ctx?.request?.headers?.get?.('origin') || ctx?.headers?.origin || '';
          const host = ctx?.request?.headers?.get?.('host') || ctx?.headers?.host || '';
          if (isAllowedProxyOrigin(origin, host, siteOrigin)) authorized = true;
        }
      } catch {}
    }
    if (!authorized) {
      this.reject(4401, 'Unauthorized');
      return;
    }

    const url = ctx?.query?.url;
    if (!url || typeof url !== 'string') {
      this.reject(4400, 'Missing url');
      return;
    }

    resolveSafeWsUrl(url)
      .then((target) => {
        if (!target || this.destroyed) {
          this.reject(4403, 'Forbidden');
          return;
        }
        this.connect(target);
      })
      .catch(() => {
        this.reject(4403, 'Forbidden');
      });
  }

  private reject(code: number, reason: string) {
    try { this.clientWs?.close?.(code, reason); } catch {}
    this.destroy();
  }

  private resetIdleTimer() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.destroy(), PROXY_WS_IDLE_TIMEOUT_MS);
  }

  private connect(target: SafeWsTarget) {
    try {
      this.upstreamWs = new WebSocket(target.url, {
        perMessageDeflate: false,
        handshakeTimeout: 15000,
        lookup: (_hostname: string, _options: any, callback: (err: Error | null, address: string, family?: number) => void) => {
          callback(null, target.pinnedAddress, 4);
        },
      } as any);
    } catch {
      this.destroy();
      return;
    }

    this.upstreamWs.on('open', () => {});
    this.upstreamWs.on('message', (data: WebSocket.Data) => {
      if (this.destroyed || !this.clientWs) return;
      this.resetIdleTimer();
      try { this.clientWs.send(data as any); } catch {}
    });
    this.upstreamWs.on('close', () => { this.destroy(); });
    this.upstreamWs.on('error', () => { this.destroy(); });
  }

  public onClientMessage(msg: any) {
    if (this.destroyed || !this.upstreamWs || this.upstreamWs.readyState !== WebSocket.OPEN) return;
    this.resetIdleTimer();
    try { this.upstreamWs.send(msg as any); } catch {}
  }

  public onClientClose() { this.destroy(); }
  public onClientError() { this.destroy(); }

  private destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    if (proxyWsSessionCount > 0) proxyWsSessionCount--;
    if (this.upstreamWs) {
      try {
        if (this.upstreamWs.readyState === WebSocket.OPEN || this.upstreamWs.readyState === WebSocket.CONNECTING) {
          this.upstreamWs.close(1000, 'Closed');
        }
      } catch {}
      this.upstreamWs = null;
    }
    if (this.clientWs) {
      try { this.clientWs.close?.(); } catch {}
      this.clientWs = null;
    }
  }
}