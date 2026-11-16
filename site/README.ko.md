[English](README.md) | 한국어

# pii.newmean.ai

정적 자산(`public/`)과 D1 데이터베이스(`pii-site`)를 쓰는 Cloudflare Worker입니다.

- `/`: 데모(`js/playground`). `public/demo/`를 `<base href="/demo/">`와 함께 제공해 상대 경로가 그대로 풀립니다.
- `/mobile-bench/?k=<공유 코드>`: 휴대폰 벤치마크(`js/experiments/phone-bench`). `/mobile-bench/models/` 아래 모델 파일과
  결과 API `/api/bench`에는 공유 코드(Worker 시크릿 `BENCH_KEY`)가 필요합니다. 끝난 실행은 D1 테이블 `bench_runs`
  (`schema.sql`)에 저장되며, 저장하는 값은 브라우저가 알려 주는 기기 정보와 측정값뿐이고 IP 주소나 다른 요청 메타데이터는
  저장하지 않습니다.
- `/api/demo`: 데모의 속도 숫자. pii.newmean.ai에서 데모는 페이지를 숨기거나 닫을 때 실행·모델 로딩마다 모델 크기, 엔진,
  시간, 토큰 수와 대략적인 기기 종류(OS, 브라우저, 폰 여부, CPU 코어, 메모리), 샘플 글인지 여부를 보냅니다. 입력한 글이나
  찾은 결과는 보내지 않으며, 데모 제목 아래 문구가 이를 알립니다. Worker는 사건마다 Workers Analytics Engine 데이터셋
  `pii_demo_runs`(바인딩 `DEMO`)에 Cloudflare가 알려 주는 나라와 함께 한 줄씩 쓰고, IP 주소는 저장하지 않습니다. 읽기는
  Analytics Engine SQL API(Account Analytics: Read 권한 API 토큰)로 합니다.

## 준비(한 번)

```bash
wrangler d1 create pii-site                                    # 출력된 database_id를 wrangler.jsonc에 넣기
wrangler d1 execute pii-site --remote --file schema.sql        # bench_runs 생성
wrangler secret put BENCH_KEY                                  # 휴대폰 벤치마크 공유 코드
```

`wrangler.jsonc`는 사용자 지정 도메인 `pii.newmean.ai`에 연결됩니다. 직접 배포할 때는 `routes`를 바꾸거나 지우세요.

## 빌드와 배포

먼저 `js/`에서 `npm install`을 실행합니다. 두 빌드 스크립트 모두 그곳의 esbuild와 onnxruntime-web을 씁니다.

```bash
node ../js/playground/build.mjs public/demo                                         # 데모 페이지, 번들, ORT wasm(모델은 Hugging Face에서 받음)
node ../js/experiments/phone-bench/build.mjs public/mobile-bench <모델 폴더>        # 벤치 페이지, 번들, ORT wasm, 모델 파일
wrangler deploy
```

`<모델 폴더>`에는 Hugging Face 모델 저장소 네 개(`pii-nano/`, `pii-small/`, `pii-medium/`, `pii-large/`)의 로컬 사본을
둡니다. `public/demo/`와 `public/mobile-bench/`는 빌드 결과물이라 git에 넣지 않습니다.

저장된 실행 보기:

```bash
wrangler d1 execute pii-site --remote --command "SELECT created_at, device, size, engine, data FROM bench_runs ORDER BY id"
```

각 실행의 `data`에는 측정한 페이지의 SDK 버전(`sdk`)이 들어 있어 릴리스별로 속도를 비교할 수 있습니다(1.5.0 전의 실행에는
없음).

```bash
wrangler d1 execute pii-site --remote --command "SELECT json_extract(data, '$.sdk') AS sdk, size, engine, count(*) AS runs FROM bench_runs GROUP BY 1, 2, 3"
```

데모의 속도 수치에도 들어 있습니다(`pii_demo_runs`의 `blob9`).
