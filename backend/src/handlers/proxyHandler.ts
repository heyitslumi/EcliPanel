import { optionalAuth } from '../middleware/auth';
import { safeFetch } from '../utils/ssrf';
import { AppDataSource } from '../config/typeorm';
import { Node } from '../models/node.entity';
import { TunnelDevice } from '../models/tunnelDevice.entity';
import { TunnelAllocation } from '../models/tunnelAllocation.entity';
import { Not, IsNull } from 'typeorm';

export function proxyRoutes(app: any, prefix: string) {
  app.get(prefix + '/internal-domains', async (ctx: any) => {
    const domains = new Set<string>();
    try {
      const backendUrl = process.env.BACKEND_URL || '';
      if (backendUrl) { try { domains.add(new URL(backendUrl).hostname); } catch { } }
    } catch { }
    try {
      if (ctx.request?.headers?.get) {
        const host = (ctx.request.headers.get('host') || '').split(':')[0];
        if (host) domains.add(host);
      }
    } catch { }
    try {
      const nodes = await AppDataSource.getRepository(Node).find({ select: { url: true, fqdn: true, proxmoxHost: true } });
      for (const node of nodes) {
        if (node.url) { try { domains.add(new URL(node.url).hostname); } catch { domains.add(node.url); } }
        if (node.fqdn) domains.add(node.fqdn);
        if (node.proxmoxHost) domains.add(node.proxmoxHost.split(':')[0]);
      }
    } catch { }
    try {
      const devices = await AppDataSource.getRepository(TunnelDevice).find({ select: { fqdn: true }, where: { kind: 'server', fqdn: Not(IsNull()) } });
      for (const d of devices) { if (d.fqdn) domains.add(d.fqdn); }
    } catch { }
    try {
      const allocs = await AppDataSource.getRepository(TunnelAllocation)
        .createQueryBuilder('alloc').select('DISTINCT alloc.host', 'host').where('alloc.status = :status', { status: 'active' }).getRawMany();
      for (const a of allocs) { if (a.host) domains.add(a.host); }
    } catch { }
    return { domains: Array.from(domains).sort() };
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
    let upstream: Response | null = null;
    try {
      upstream = await safeFetch(url, {
        method: ctx.request.method || 'GET',
        headers: { 'User-Agent': 'EcliPanel-Proxy/3.0', 'Accept': '*/*' },
        signal: AbortSignal.timeout(15000),
      });
    } catch { upstream = null; }
    if (!upstream) { ctx.set.status = 403; return { error: 'Host not allowed' }; }
    const ct = upstream.headers.get('content-type') || 'application/octet-stream';
    return new Response(new Uint8Array(await upstream.arrayBuffer()), { status: upstream.status, headers: { 'Content-Type': ct, 'Cache-Control': 'public, max-age=86400' } });
  }, { beforeHandle: [optionalAuth], detail: { tags: ['Proxy'], summary: 'Generic external URL proxy' } });

  const SITES: Record<string, string> = { chunkbase: 'https://www.chunkbase.com', mcseedmap: 'https://mcseedmap.net' };
  const AD = /ads\.adthrive\.com|pagead2\.googlesyndication\.com|doubleclick\.net|googletagmanager\.com|google-analytics\.com|googletagservices\.com|adnxs\.com|rubiconproject\.com|criteo\.com|amazon-adsystem\.com|pubmatic\.com|openx\.net|moatads\.com|scorecardresearch\.com|quantserve\.com|outbrain\.com|taboola\.com|yandex\.ru\/ads/i;

  function makeProxyJS(proxyPath: string, siteOrigin: string): string {
    const siteHost = (() => { try { return new URL(siteOrigin).hostname; } catch { return ''; } })();
    return `<script data-panel-proxy>
(function(){
  'use strict';
  var P='${proxyPath}', E='${prefix}/proxy/external?url=', SH='${siteHost}';
  
  var isAd = function(u){return typeof u==='string'&&${AD.toString()}.test(u);};
  var skip = function(u){return typeof u!=='string'||u.indexOf('blob:')===0||u.indexOf('data:')===0||u.indexOf('javascript:')===0||/^\\/?api\\/proxy\\//.test(u)?u:null;};
  
  var fix = function(u){
    var s=skip(u); if(s!==null)return s;
    if(isAd(u))return'about:blank';
    
    if(/^\\/\\//.test(u)){
      u='https:'+u;
      try{var h=new URL(u).hostname;if(h===SH)return P+new URL(u).pathname+new URL(u).search+new URL(u).hash;}catch(e){}
      return E+encodeURIComponent(u);
    }
    if(/^https?:\\/\\//.test(u)){
      try{var h2=new URL(u).hostname;if(h2===SH)return P+new URL(u).pathname+new URL(u).search+new URL(u).hash;}catch(e){}
      return E+encodeURIComponent(u);
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

  var _WS=WebSocket;
  window.WebSocket=function(u,p){
    var f=fix(u);
    if(/^https?:/.test(f)) f=f.replace(/^http/,'ws');
    return new _WS(f,p);
  };

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
      const upstream = await fetch(target, {
        method: ctx.request.method || 'GET',
        headers: {
          'User-Agent': 'EcliPanel-WebProxy/3.0',
          'Accept': ctx.request.headers?.get?.('accept') || '*/*',
          'Referer': origin + '/'
        },
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
        }

        const jsTag = makeProxyJS(proxyPath, origin);
        if (html.includes('</head>')) {
          html = html.replace('</head>', jsTag + '</head>');
        } else if (html.includes('<head>')) {
          html = html.replace('<head>', '<head>' + jsTag);
        } else if (html.includes('<html>')) {
          html = html.replace('<html>', '<html><head>' + jsTag + '</head>');
        } else {
          html = jsTag + html;
        }

        body = new TextEncoder().encode(html);
      }

      const responseHeaders: Record<string, string> = {
        'Content-Type': ct || 'application/octet-stream',
        'Cache-Control': 'public, max-age=3600',
        'X-Frame-Options': 'SAMEORIGIN'
      };

      const corsHeaders = ['access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers'];
      for (const h of corsHeaders) {
        const v = upstream.headers.get(h);
        if (v) responseHeaders[h] = v;
      }

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
}