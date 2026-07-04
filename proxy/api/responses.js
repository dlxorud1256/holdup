// OpenAI API CORS 프록시 (Vercel Function, 미국 리전 고정)
// 브라우저는 OpenAI를 직접 호출할 수 없으므로(CORS 차단) 이 함수가 중계한다.
// 미국 리전(vercel.json의 iad1)에서 실행되므로 OpenAI 지역 차단에 걸리지 않는다.
// API 키는 저장하지 않고 요청 헤더로 통과만 시킨다 — 각 사용자가 자기 키를 쓴다.

const ALLOWED_ORIGINS = [
  'https://dlxorud1256.github.io', // 배포된 게임
  'http://localhost:5173', // 로컬 개발
]

function corsHeaders(request) {
  const origin = request.headers.get('origin') ?? ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    // OpenAI SDK가 x-stainless-* 등 부가 헤더를 붙이므로, 프리플라이트가 요청한 헤더를 그대로 허용
    'Access-Control-Allow-Headers':
      request.headers.get('access-control-request-headers') ?? 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
  }
}

export async function OPTIONS(request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) })
}

export async function POST(request) {
  const upstream = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: request.headers.get('authorization') ?? '',
      'Content-Type': 'application/json',
    },
    body: await request.text(),
  })

  // 스트리밍(SSE) 응답을 그대로 통과시키면서 CORS 헤더를 붙인다
  const headers = new Headers(corsHeaders(request))
  headers.set('Content-Type', upstream.headers.get('content-type') ?? 'application/json')
  return new Response(upstream.body, { status: upstream.status, headers })
}
