# doodle-prompt

[English](README.md) | 한국어

**생각을 글로 쓰지 말고, 그리세요.**

Claude와 같이 쓰는 캔버스를 별도 창으로 띄우는 Claude Code 플러그인입니다. 사용자가 끄적이면 Claude가 같은 캔버스에 답을 그리고, 그렇게 주고받을수록 스케치가 조금씩 분명해집니다. 긴 프롬프트를 쓸 필요 없이 상자, 화살표, 떠올린 모양을 그대로 그리면 됩니다.

```
나:      ▭ ──→           (대충 그린 상자와 화살표)
Claude:  [로그인] ─성공→ [대시보드]   [ ? ]
         "대시보드에는 또 뭐가 들어가요?"
나:      (? 에 동그라미, 차트를 끄적끄적)
...
```

## 사용 방법

1. Claude Code에서 `/doodle`을 입력하거나 "그려서 보여줄게"라고 말하면 캔버스가 별도 창으로 열립니다. 터미널 옆에 두고 쓰세요.
2. 그립니다. 펜, 도형, 텍스트로 그리고 선택 도구로 옮길 수 있습니다. 선 굵기와 색을 고를 수 있고, 그림을 여러 레이어로 나눠 순서를 바꾸거나 숨기거나 이름을 바꾸거나 지울 수 있고, 스크린샷이나 글자를 붙여넣을 수 있습니다.
3. **Send to Claude**를 누릅니다. 하고 싶은 말이 있으면 짧게 적어도 되지만, 안 적어도 됩니다.
4. Claude가 지금까지의 대화와 레포 맥락에 맞춰 스케치를 해석하고 같은 캔버스에 그립니다. 대충 그린 도형을 깔끔하게 다듬거나, 빠진 부분을 채우거나, 점선 `?` 상자로 질문합니다.
5. 이렇게 계속 주고받다가 생각이 분명해지면 Claude에게 만들어 달라고 하면 됩니다.

에이전트가 그린 것은 보라색이고 사용자가 그린 것은 고른 색 그대로라서 누가 그렸는지 바로 구분됩니다. 실행 취소는 누가 그렸든 똑같이 됩니다.

## 설치

### Claude Code

```
/plugin marketplace add JuwonHwang/doodle-prompt
/plugin install doodle-prompt@doodle-prompt
```

필요한 것은 모두 플러그인 안에 들어 있습니다. Node.js 18 이상만 있으면 되고, 다른 의존성은 없습니다.

### 다른 에이전트

캔버스는 일반 CLI라서 셸 명령을 실행할 수 있는 에이전트라면 어디서든 쓸 수 있습니다.

```
npx doodle-prompt start   # 캔버스 열기
npx doodle-prompt wait    # 사용자가 Send를 누를 때까지 대기
npx doodle-prompt draw -  # 표준 입력으로 받은 JSON 도형 그리기
```

`npx doodle-prompt help`로 전체 명령을 볼 수 있습니다. 주고받는 흐름과 도형 형식은 [`skills/doodle/SKILL.md`](skills/doodle/SKILL.md)에 정리되어 있습니다. 지금은 Claude Code에서만 테스트했으며, 다른 에이전트 지원 기여를 환영합니다.

## 세부 사항

- **로컬 서버**: 캔버스 서버는 내 컴퓨터의 `127.0.0.1`에서만 돌아갑니다. 포트는 4777이고, 사용 중이면 빈 포트를 씁니다. 평소 Claude가 보는 것 외에는 아무것도 외부로 나가지 않습니다.
- **저장 위치**: 스케치는 프로젝트의 `.doodle/` 폴더에 저장되고, 이 폴더는 스스로 git에서 제외됩니다.
- **창 방식**: Chrome이나 Edge가 설치되어 있으면 탭 없는 앱 창으로 열리고, 없으면 일반 탭으로 열립니다. 다른 브라우저를 쓰려면 `DOODLE_BROWSER`를 지정하고, 항상 탭으로 열려면 `start --tab`을 쓰세요.
- **대기 방식**: Claude는 백그라운드 명령으로 보내기를 기다리기 때문에 그리는 동안에도 채팅을 계속할 수 있습니다. 툴바의 상태 점은 Claude가 지금 기다리고 있는지를 보여 줍니다. 기다리지 않을 때 보낸 그림은 쌓여 있다가 다음에 Claude가 확인할 때 전달됩니다.

단축키: `V` 선택, `P` 펜, `E` 지우개, `T` 텍스트, `R` 사각형, `O` 원, `A` 화살표, `F` 채우기, `L` 레이어, `C` 채팅 패널, `Ctrl/⌘ +`/`-`/`0` 확대·축소·화면 맞춤, `Space`+드래그 이동, `Delete` 선택한 것 지우기, `Ctrl/⌘+Z` 실행 취소, `Ctrl/⌘+Shift+Z` 다시 실행, `Ctrl/⌘+C`/`X`/`V` 복사·잘라내기·붙여넣기, `Ctrl/⌘+Enter` 보내기

## 구성

```
src/doodle.mjs                    캔버스 서버 + CLI (start, wait, check, draw, state, undo, redo, clear, stop)
src/canvas.html                   캔버스 화면
src/icon*.svg, icon-*.png       앱 아이콘 (탭, 창, 작업 표시줄)
package.json                      npm 패키지 (bin: doodle-prompt)
.claude-plugin/plugin.json        Claude Code 플러그인 매니페스트
.claude-plugin/marketplace.json   이 레포를 마켓플레이스로 추가할 수 있게 해 주는 파일
skills/doodle/SKILL.md            Claude가 스케치를 주고받는 방법
```

## 라이선스

MIT
