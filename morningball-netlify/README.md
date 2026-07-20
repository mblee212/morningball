# 모닝볼 (Morning Ball) — KBO 전 구단판

매일 아침 KBO 1군 10개 구단 브리핑 대시보드. 라이브: 사용자의 Netlify 사이트.

## v6 변경점 (10개 구단 확장)
- 화면: 상단 탭 3개(경기정보 · KBO 순위 · 뉴스) + 우하단 플로팅 ⚾ 버튼으로 10개 구단 선택
- 팀 선택 시 전체 테마 컬러가 해당 구단 색으로 전환, 순위표 하이라이트·뉴스도 선택 구단 기준
- 배치: 하루 최대 5경기 전체 수집 — 프리뷰(경기당 1회)·날씨(구장당 1회)·시즌 일정(하루 1회) 캐시로 API 호출 최소화
- 뉴스: 10개 구단명 키워드 × 전날 00시~당일 검색 + 구단 공식 채널 10곳 상시 링크
- 경기 없는 구단은 "휴식일"로 자동 처리

## 폴더 구조
```
deploy/
├── index.html                       # 대시보드 (내장 샘플 = 최후 폴백)
├── data.json.seed                   # 최초 1회 시드
├── package.json                     # @netlify/blobs 의존성
├── netlify.toml                     # 배포·배치 스케줄
└── netlify/functions/
    ├── _lib.mjs                     # 서버측 검증기 + KST 유틸
    ├── _batches.mjs                 # 배치 오케스트레이션 (조립·격리·검증·저장)
    ├── collectors/naver.mjs         # 일정·선발·프리뷰 라인업·상대전적
    ├── collectors/kbo.mjs           # KBO 공식 순위표 (최근10·연속·추이)
    ├── collectors/weather.mjs       # 기상청 예보 + 에어코리아 → 진행 가능성
    ├── collectors/news.mjs          # 네이버 뉴스 검색 (전날 00시~현재)
    ├── batch1-starters.mjs          # [예약] 당일 0시 KST
    ├── batch2-lineup.mjs            # [예약] 30분 폴링 → 시작 90분 전 실행
    ├── run-batch.mjs                # [수동] 배치 즉시 실행 (테스트/긴급)
    ├── seed.mjs                     # [수동] 최초 1회 시드 적재
    └── data.mjs                     # GET /data.json 응답
```

## 셋업 체크리스트 (순서대로)
1. **API 키 발급 (2곳)**
   - 공공데이터포털(data.go.kr): 「기상청_단기예보 조회서비스」·「한국환경공단_에어코리아_대기오염정보」 활용신청 → 인증키 1개로 둘 다 사용 → `WEATHER_KEY`
   - 네이버 개발자센터(developers.naver.com): 애플리케이션 등록 → 검색 API 사용 → `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`
2. **Netlify 환경변수 등록** — Site configuration → Environment variables:
   `WEATHER_KEY`, `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, `ADMIN_KEY`(직접 만든 긴 비밀 문자열)
3. **재배포** — 이 폴더를 Git 저장소로 연결(예약 함수는 Git 연동/CLI 배포에서만 동작, 드래그&드롭 불가)
4. **시드 적재 (최초 1회)** — 브라우저에서 `https://<사이트>/.netlify/functions/seed?key=<ADMIN_KEY>`
5. **수동 테스트**
   - `.../run-batch?which=1&key=<ADMIN_KEY>` → 응답의 sources에서 소스별 ok/실패 확인
   - `.../run-batch?which=2&key=<ADMIN_KEY>&force=1` → 라인업 강제 갱신 테스트
   - 사이트 새로고침 → 상단 칩이 `LIVE DATA · 1배치 ✓`로 바뀌면 성공

## 배치 동작 (KST)
| 배치 | 시각 | 내용 |
|---|---|---|
| 1배치 | 매일 00:00 | 오늘 경기·선발투수·진행가능성(기상/미세먼지)·상대전적·순위·record·승리확률·뉴스 |
| 2배치 | 경기 시작 −90분 | 확정 라인업 9인 + 선수별 시즌/선발 상대 기록 (30분 폴링, 미발표 시 다음 주기 재시도) |

## 데이터 무결성 (절대 오류 금지 설계)
- **소스별 격리**: 수집기 하나가 실패해도 그 영역만 이전 정상값 유지, 나머지는 반영. 실패 내역은 `meta.sources`에 기록되어 run-batch 응답/함수 로그로 확인.
- **저장 전 검증**: 조립본이 스키마 검증 실패 시 저장 자체가 차단.
- **프런트 재검증 + 내장 폴백**: 화면은 언제나 정상 렌더링.
- **정직한 표기**: 입력 데이터가 없는 지표는 값을 지어내지 않고 "—"로 표기.

## 세이버 지표 자체 계산 (collectors/compute.mjs)
스탯티즈 없이, 네이버 프리뷰의 카운팅 기록 + KBO 공식 팀 기록(리그 상수)만으로 아래를 매일 계산:
- 타자: BB% · K% · ISO · BABIP · wOBA · **wRC+*(파크팩터 미보정, * 표기)** · RC27 · GPA · BB/K · PSN(파워-스피드) · AB/HR · SecA
- 투수: K/9 · BB/9 · HR/9 · **FIP**(리그 상수 기반) · K% · BB% · **kwERA** · K-BB% · K/BB · LOB%
- 리그 상수(lgwOBA·R/PA·cFIP)는 KBO 공식 팀 타자(Basic1+Basic2)·팀 투수 페이지 합산으로 매일 산출
- 트래킹 계열(Barrel%·구속·회전수 등)은 KBO 비공개라 **대시보드에서 제외**했고, WAR·WPA·파크보정 wRC+가 필요해지면 스탯티즈 수집기를 추가하는 확장 지점만 남겨둠

## 소스 및 주의
- 일정·선발·라인업: 네이버 스포츠 비공식 JSON API — 필드명 변경 가능성에 대비해 후보키 순차 탐색으로 구현. 구조 변경 시 해당 소스만 keep-prev로 격리되며 로그로 감지됨.
- 순위: KBO 공식 홈페이지(서버 렌더링 표) 파싱. 추이 스파크라인은 일별 승률을 8포인트 롤링 적재.
- 진행 가능성: 강수확률(경기 시간대 최대)·기온·PM10을 점수화. 개별 리스크가 '높음'이면 판정을 자동 강등.


## v6.1 실서버 연동 수정 (첫 run-batch 결과 반영)
- 순위 URL: `TeamRank.aspx`(연도별) → **`TeamRankDaily.aspx`(일자별 최신)** 로 교체
- 순위 파서: 한 페이지의 여러 표(순위·팀간승패·홈방문) 중 순위표만 정확히 선별 (승률·최근10경기 형식으로 판별)
- 리그 상수 IP: 컬럼명 자동탐색(IP/이닝/INN) + "x.1/x.2"·"x 1/3"·정수 표기 모두 처리 + IP 없으면 ERA·ER로 총이닝 역산
- 날씨: 실패 시 기상청/에어코리아 resultCode를 sources 로그에 노출 (키 미등록 30 vs 데이터없음 03 구분)
- 실제 KBO 페이지 데이터로 순위 파싱 검증 완료, 리그 상수 3개 IP 시나리오 검증 완료

### 날씨가 계속 실패하면 (kma FAIL / air FAIL)
코드가 아니라 WEATHER_KEY 문제일 가능성이 큽니다. sources 로그의 메시지를 확인:
- `기상청 30:...` → 키 미등록/오타 → Netlify 환경변수 WEATHER_KEY 재확인(Decoding 키)
- `기상청 03:...` → 정상(해당 시간 예보 없음), 잠시 후 재시도
- 활성화 직후면 최대 반나절~하루 전파 지연 가능

## v6.2 미세먼지 안정화 (air FAIL 해결)
- 에어코리아를 **측정소별 조회 → 시도별 실시간 조회**로 전환 (getCtprvnRltmMesureDnsty)
- 측정소명 정확 일치에 의존하던 구조를 제거: 시도(서울/대구/부산/경남…) 응답에서
  구장 인근 시군구를 우선 선택, 없으면 유효 측정값의 중앙값 사용 (이상치 -999 자동 제외)
- 잠실·대구·창원·부산 등 이전 air FAIL 구장 전부 해소, 6개 시나리오 검증 완료
- 이제 진행 가능성 게이지 = 기상청 강수확률 + 에어코리아 PM10 모두 실데이터 기반

## v7.0 실제 네이버 응답 구조 반영 (선발/라인업 정확화) — 중요
이전까지 선발·라인업이 **추측한 필드명**에 의존해 타 팀 선수가 노출되던 문제를 근본 해결.
실제 2026-07-18 응답을 확보해 필드 구조를 확정하고 수집기를 재작성함:
- **홈/원정**: games의 homeTeamCode/awayTeamCode가 이미 실제값 (reversedHomeAway는 UI 표시용 플래그이므로 무시)
- **선발명**: `homeStarter.playerInfo.name` (이전 오류: `.playerName`)
- **선발 기록**: currentSeasonStats(era·w·l·whip·kk·bb·inn2·hit·hr·er)로 FIP·K/9 등 자체 계산
- **구종**: currentPitKindStats[{type,pit_rt,speed}] → 구사율 막대
- **라인업**: `homeTeamLineUp.fullLineUp[]`의 batorder 1~9 (position="1"은 선발투수라 제외)
- **상대전적**: `seasonVsResult`(hw/hd/hl/aw/ad/al) — 별도 계산 없이 집계값 사용
- **최근5경기**: homeTeamPreviousGames/awayTeamPreviousGames의 hScore/aScore
- **record**: homeStandings/awayStandings(w·d·l·rank). 순위표 값이 최종(전 구단 커버)
- 실제 HTSK(SSG-KIA) 응답으로 검증: 해치/네일 선발, 정준재~최준우·김호령~정현창 라인업, 3-1-6 상대전적 전부 일치
- 라인업 타자의 시즌 지표는 프리뷰에 없어 "—"로 표기(지어내지 않음). 향후 기록실 연동 시 채워짐

## v7.1 라인업 타자 시즌 지표 채우기 (선수 기록 API 연동)
- 라인업 9명 각자의 시즌 지표를 /players/kbo/{playerCode}/playerend-record 로 개별 조회해 채움
- 응답의 basicRecord·record·vsTeam은 문자열 인코딩 JSON이라 재파싱
- record.season(2026)에서 네이버가 계산한 wOBA·BABIP·ISO·wRC+·WAR·WPA 직접 사용 (자체계산 대체)
- vsTeam에서 오늘 상대팀 성적 추출 → 상대 전적 컬럼(vsKey/vsDetail)
- 타자 adv 구조를 WAR/WPA/RBI/OBP/SLG/2B/3B/CS로 통일 (샘플·시드·라이브 모두)
- GLOSS 용어사전·강조키도 새 지표로 갱신, 구지표(RC27/GPA/SecA/PSN/BB-K/AB-HR) 완전 제거
- 실제 정준재(54812)로 검증: 타율.283 OPS.721 wRC+97 WAR1.90 WPA1.19, vs KIA .243 전부 일치
- 개별 선수 조회 실패 시 그 타자만 이름·포지션 유지(부분 실패 격리), 소스에 지표 N/9 표기

## v7.2 불펜 투수 실데이터 갱신 (부상/말소 선수 자동 제외)
- 2배치에서 라인업 발표 시 pitcherBullpen(오늘 엔트리 등록 불펜 명단)으로 불펜 교체
- 부상·말소된 선수는 이 명단에 없으므로 자동 제외 (기존 샘플의 유영찬 등 문제 해결)
- 오늘 엔트리에 등록된 불펜 전원을 playerCode로 개별 조회해 실제 지표 채움 (5명씩 병렬 처리)
- 투수 매핑(mapPitcherRecord): season(2026)의 era·whip·k9·bb9·kbb·kp·bbp·war·wpa·sv·hold + FIP 자체계산
- 구종(chart.pit_kind.player)·상대팀 성적(vsTeam) 포함, 역할은 '계투'로 통일(당일 보직 미확정)
- 실제 조병현(51897)로 검증: ERA3.03 WHIP1.38 K/9 11.3 SV10 WAR0.74 K-BB%13.7, vs KIA 4.91 전부 일치
- 개별 조회 실패 시 그 투수만 이름 유지(부분 실패 격리), 소스에 bullpen_{팀} 지표 개수 표기