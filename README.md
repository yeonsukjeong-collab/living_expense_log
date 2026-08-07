# 가계부 (living-expense-log)

신용카드 승인 문자를 붙여넣으면 자동으로 파싱해서 카드사별로 정리하고, 영수증이 있는 거래는 상세 항목을 추가할 수 있는 개인용 가계부 웹앱입니다.

현재 KB국민카드, 현대카드, 신한카드(체크) 문자 형식을 인식합니다. 인식하지 못한 문자는 원문을 보여주고 직접 입력할 수 있습니다.

## 로컬에서 실행하기

1. PostgreSQL이 필요합니다 (로컬 설치 또는 Render/Neon 등 무료 DB 사용 가능).
2. `.env.example`을 복사해 `.env`를 만들고 값을 채웁니다.

   ```
   cp .env.example .env
   ```

3. 의존성 설치 후 실행합니다.

   ```
   npm install
   npm start
   ```

4. 브라우저에서 http://localhost:3000 접속 후 `.env`에 설정한 `APP_PASSWORD`로 로그인합니다.

## Render에 배포하기 (무료 플랜)

1. 이 저장소를 GitHub에 올립니다.
2. Render 대시보드에서 **New > Blueprint**를 선택하고 이 저장소를 연결하면 `render.yaml`에 정의된 웹 서비스와 무료 PostgreSQL이 함께 생성됩니다.
   - Blueprint를 쓰지 않는다면: **New > PostgreSQL**로 무료 DB를 만든 뒤, **New > Web Service**로 이 저장소를 연결하고 Build Command `npm install`, Start Command `npm start`를 지정합니다.
3. 웹 서비스 환경변수에서 `APP_PASSWORD`(로그인 비밀번호)를 직접 입력합니다. `DATABASE_URL`과 `SESSION_SECRET`은 Blueprint가 자동으로 채워줍니다.
4. 배포가 끝나면 Render가 준 URL로 휴대폰에서도 접속할 수 있습니다.

### 무료 플랜 유의사항

- Render 무료 PostgreSQL은 **생성 후 90일이 지나면 만료**됩니다. 만료 전 앱 안의 **내보내기** 버튼으로 JSON 백업을 받아두고, DB를 새로 만든 뒤 `DATABASE_URL`만 갱신하면 앱은 그대로 이어서 쓸 수 있습니다 (데이터는 백업에서 수동으로 복원해야 합니다).
- 무료 웹 서비스는 일정 시간 요청이 없으면 슬립 상태가 되어 첫 접속 시 몇 초 정도 로딩이 걸릴 수 있습니다.

## 문자 붙여넣기 형식

여러 건을 한 번에 붙여넣을 때는 문자 사이를 빈 줄로 구분하면 가장 안정적으로 인식됩니다. 카카오톡 등에서 연속으로 복사해 붙여도 카드사 문자의 시작 패턴을 기준으로 자동 분리를 시도합니다.
