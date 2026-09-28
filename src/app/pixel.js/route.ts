export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const script = `(()=>{try{const s=document.currentScript;const clientId=s&&s.dataset.clientId;if(!clientId)return;const key='_fz_visitor';let visitorId=localStorage.getItem(key);if(!visitorId){visitorId=crypto.randomUUID();localStorage.setItem(key,visitorId)}const u=new URL(location.href);const keys=['gclid','gbraid','wbraid','fbclid','utm_source','utm_medium','utm_campaign','utm_term','utm_content'];const attribution={};for(const k of keys){const v=u.searchParams.get(k);if(v)attribution[k]=v}const saved=JSON.parse(localStorage.getItem('_fz_attribution')||'{}');const merged={...saved,...attribution};localStorage.setItem('_fz_attribution',JSON.stringify(merged));fetch('${origin}/api/pixel/collect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({clientId,visitorId,pageUrl:location.href,referrer:document.referrer,attribution:merged}),keepalive:true}).catch(()=>{})}catch{}})();`;
  return new Response(script, {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'access-control-allow-origin': '*',
      'x-content-type-options': 'nosniff',
    },
  });
}
