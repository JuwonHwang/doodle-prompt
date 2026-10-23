# doodle-prompt

[English](README.md) | 한국어

**생각을 글 대신 그림으로 전달한다.**

doodle-prompt는 Claude와 함께 쓰는 캔버스를 여는 Claude Code 플러그인이자 데스크톱 앱(macOS, Windows)이다. 캔버스는 별도 창이나 화면 전체를 덮는 투명 오버레이로 열린다. 사용자가 그리면 Claude가 같은 캔버스에 답을 그린다. 이 과정을 반복할수록 스케치가 구체적으로 바뀐다. 긴 프롬프트를 쓰지 않고 상자, 화살표, 떠올린 모양을 그리면 된다.

```
나:      ▭ ──→           (대충 그린 상자와 화살표)
Claude:  [로그인] ─성공→ [대시보드]   [ ? ]
         "대시보드에는 또 무엇이 들어가나요?"
나:      (? 에 동그라미, 차트를 그림)
...
```

## 사용 방법

1. Claude Code에서 `/doodle`을 입력하거나 "그려서 보여줄게"라고 말하면 캔버스가 별도 창으로 열린다. 창은 터미널 옆에 둔다.
2. 그린다. 펜, 도형, 텍스트로 그리고 선택 도구로 옮긴다. 선 굵기와 색을 고를 수 있다. 그림을 여러 레이어로 나누어 순서를 바꾸거나, 숨기거나, 이름을 바꾸거나, 지울 수 있다. 스크린샷과 글자를 붙여 넣을 수 있다.
3. **Send to Claude**를 누른다. 메모는 적지 않아도 된다.
4. Claude는 지금까지의 대화와 저장소 내용을 바탕으로 스케치를 해석하고 같은 캔버스에 그린다. 대충 그린 도형을 정리하거나, 빠진 부분을 채우거나, 점선 `?` 상자로 질문한다.
5. 이 과정을 반복하다가 원하는 것이 분명해지면 Claude에게 구현을 요청한다.

에이전트가 그린 것은 보라색이고, 사용자가 그린 것은 사용자가 고른 색으로 남는다. 그래서 누가 그렸는지 구분된다. 실행 취소는 누가 그린 것이든 적용된다.

## 설치

### Claude Code

```
/plugin marketplace add JuwonHwang/doodle-prompt
/plugin install doodle-prompt@doodle-prompt
```

캔버스는 doodle-prompt 데스크톱 앱이 연다. 앱은 [최신 릴리스](https://github.com/JuwonHwang/doodle-prompt/releases/latest)에서 받아 설치한다(아래 세부 사항 참고). 플러그인에는 Node.js 18 이상이 필요하다.

### 다른 에이전트

캔버스는 일반 CLI로 조작하므로 셸 명령을 실행할 수 있는 에이전트라면 쓸 수 있다.

```
npx doodle-prompt start   # 캔버스 열기
npx doodle-prompt wait    # 사용자가 Send를 누를 때까지 대기
npx doodle-prompt draw -  # 표준 입력으로 받은 JSON 도형 그리기
```

`npx doodle-prompt help`는 전체 명령을 보여 준다. 주고받는 절차와 도형 형식은 [`skills/doodle/SKILL.md`](skills/doodle/SKILL.md)에 있다. 지금은 Claude Code에서만 테스트했다. 다른 에이전트 지원 요청을 포함해 이슈는 받지만 PR은 받지 않는다. 자세한 내용은 [CONTRIBUTING.md](CONTRIBUTING.md)에 있다.

## 세부 사항

- **로컬 서버**: 캔버스 서버는 이 컴퓨터의 `127.0.0.1`에서만 실행된다. 포트는 4777이고, 4777을 다른 프로그램이 쓰고 있으면 빈 포트를 쓴다. Claude가 평소에 보는 것 외에는 외부로 전송되는 것이 없다.
- **저장 위치**: 스케치는 프로젝트의 `.doodle/` 폴더에 저장된다. 이 폴더는 자체 `.gitignore`로 git에서 제외된다.
- **데스크톱 앱**: 캔버스는 doodle-prompt 데스크톱 앱(macOS, Windows)이 연다. [최신 릴리스](https://github.com/JuwonHwang/doodle-prompt/releases/latest)에서 macOS는 `.dmg`, Windows는 `Setup .exe`를 받아 설치한다. 빌드에 코드 서명이 없다. 그래서 macOS에서는 처음 실행할 때 앱을 우클릭해 "열기"를 선택하고, Windows에서는 SmartScreen에서 "실행"을 선택해야 한다. 저장소를 받아 `npm install`을 실행하면 `start`가 로컬 Electron으로 앱을 연다. `npm run dist`는 설치 파일을 `dist/`에 만든다. 다른 앱 빌드를 쓰려면 `DOODLE_APP`에 경로를 지정한다.
- **오버레이**: `start --overlay`나 툴바의 화면 버튼을 누르면 캔버스가 화면 전체를 덮는 투명 창으로 열린다. 이 창에서는 열려 있는 앱 위에 바로 그린다.
  - **클릭 통과**: `Esc`나 클릭 통과 버튼을 누르면 그린 것은 화면에 남고 클릭은 아래 앱으로 전달된다. 같은 버튼을 다시 누르면 그리기로 돌아온다.
  - **접기**: 접기 버튼을 누르면 캔버스, 툴바, 채팅이 숨고 떠 있는 아이콘만 남는다. 아이콘은 끌어서 옮길 수 있고, 누르면 오버레이가 다시 펼쳐진다.
  - **여러 모니터**: 오버레이를 접고 아이콘을 다른 화면으로 끌면 오버레이도 그 화면으로 옮겨진다.
  - **창 모드**: 창 버튼을 누르면 일반 캔버스 창으로 돌아간다.
  - **화면 캡처**: 보낸 이미지에는 그림 아래 화면의 캡처가 포함된다. macOS에서는 화면 기록 권한이 필요하며, 앱이 오버레이를 처음 열 때 권한을 요청한다.
- **대기 방식**: Claude는 백그라운드 명령으로 보내기를 기다린다. 그래서 그리는 동안에도 채팅을 계속할 수 있다. 채팅 패널의 상태 아이콘은 Claude가 지금 기다리고 있는지 보여 준다. Claude가 기다리지 않을 때 보낸 그림은 보관되었다가 Claude가 다음에 확인할 때 전달된다.

단축키: `V` 선택, `P` 펜, `E` 지우개, `T` 텍스트, `R` 사각형, `O` 원, `A` 화살표, `F` 채우기, `L` 레이어, `C` 채팅 패널, `Ctrl/⌘ +`/`-`/`0` 확대·축소·화면 맞춤, `Space`+드래그 이동, `Delete` 선택 항목 삭제, `Ctrl/⌘+Z` 실행 취소, `Ctrl/⌘+Shift+Z` 다시 실행, `Ctrl/⌘+C`/`X`/`V` 복사·잘라내기·붙여 넣기, `Ctrl/⌘+Enter` 보내기, `Esc` 오버레이 클릭 통과

## 구성

```
src/doodle.mjs                    캔버스 서버 + CLI (start, wait, check, draw, state, undo, redo, clear, stop), 앱 실행
src/canvas.html                   캔버스 화면
src/icon*.svg, icon-*.png         앱 아이콘 (탭, 창, 작업 표시줄)
app/main.mjs                      데스크톱 앱 (Electron): 캔버스 창과 오버레이
app/preload.cjs                   캔버스 페이지가 앱에 요청할 수 있는 기능
.github/workflows/release.yml     v* 태그를 푸시하면 macOS, Windows 앱 빌드
package.json                      npm 패키지 (bin: doodle-prompt)와 앱 빌드 설정
.claude-plugin/plugin.json        Claude Code 플러그인 매니페스트
.claude-plugin/marketplace.json   이 저장소를 마켓플레이스로 추가하기 위한 파일
skills/doodle/SKILL.md            Claude가 스케치를 주고받는 절차
```

## 기여

이슈는 받고 PR은 받지 않는다. 포크는 자유이다. 자세한 내용은 [CONTRIBUTING.md](CONTRIBUTING.md)에 있다.

## 라이선스

MIT
