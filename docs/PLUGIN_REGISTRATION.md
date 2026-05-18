# Plugin Registration Guide

이 문서는 LEaps Image Viewer에 이미지 분석 알고리즘을 "플러그인"으로 붙이는 규칙을 설명한다. 사람 개발자와 LLM agent가 같은 기준으로 구현할 수 있도록, 용어, 파일 배치, 등록 절차, API 계약, 검증 방법을 함께 정의한다.

현재 `BadPx`는 별도 플러그인 시스템이 아니라, 뷰어 안에 직접 붙인 synthetic bad-pixel sample loader와 검사 데모다. 이 문서는 그 경험을 바탕으로 앞으로 만들 플러그인 등록 계약을 정의한다.

## Goal

플러그인의 목표는 agent가 이미지 뷰어를 단순 화면으로만 보지 않고, raw Bayer 값과 ROI 통계, 검출 결과, overlay 조작을 안정적으로 사용할 수 있게 만드는 것이다.

좋은 플러그인은 다음 조건을 만족해야 한다.

- raw frame을 파괴하지 않는다.
- Bayer CFA 좌표계를 명확히 지킨다.
- 입력과 출력이 JSON으로 설명 가능하다.
- agent가 호출하기 좋은 이름과 설명을 가진다.
- 결과를 화면 overlay와 machine-readable result 둘 다로 남긴다.
- 같은 입력에 대해 deterministic하게 동작한다.

## Terms

`plugin`:
뷰어가 로드할 수 있는 알고리즘 패키지다. 하나 이상의 tool을 제공한다.

`tool`:
agent가 호출할 수 있는 단일 기능이다. 예: `scanBadPixels`, `measureRoiStats`, `findSaturatedRegions`.

`manifest`:
플러그인의 이름, 버전, entry file, 제공 tool 목록, 입력 schema, 출력 schema를 적은 JSON 파일이다.

`entry module`:
브라우저에서 import되는 JavaScript module이다. 실제 tool 구현과 등록 함수를 가진다.

`offline script`:
샘플 생성이나 대량 변환처럼 브라우저 밖에서 실행하는 Node/Python 스크립트다. 플러그인 본체는 아니지만 테스트 데이터를 만들 때 사용할 수 있다.

## Current State

현재 repo에는 동적 플러그인 loader가 아직 없다. 대신 아래 기능이 직접 연결되어 있다.

- `tools/make_bad_pixel_sample.mjs`: 원본 Bayer raw에 synthetic bad pixel을 심는 offline script.
- `src/main.js`: `BadPx` 버튼, `Find Bad Pixels` 버튼, `findBadPixels()` 검사 루틴.
- `window.LEapsViewer.findBadPixels()`: 브라우저 global API로 노출된 검사 함수.

따라서 지금 단계에서 "플러그인 등록"은 아직 수동 등록이다. 알고리즘을 추가하려면 `src/algorithms/` 같은 module로 분리하고, `src/main.js`에서 import한 뒤 `window.LEapsViewer`와 UI action에 연결한다.

## Target Layout

권장 파일 배치는 다음과 같다.

```text
plugins/
  bad-pixel/
    plugin.json
    index.js
    README.md
    fixtures/
      sample_badpixels.json
      sample_badpixels.raw

src/
  pluginRuntime/
    registry.js
    schemas.js
  algorithms/
    badPixel.js

tools/
  make_bad_pixel_sample.mjs
```

초기 구현에서는 `plugins/`를 바로 만들지 않아도 된다. 먼저 `src/algorithms/*.js`로 알고리즘을 분리하고, 나중에 `plugins/*/plugin.json` 기반 loader로 승격한다.

## Manifest Contract

플러그인은 `plugin.json`을 가진다.

```json
{
  "id": "bad-pixel",
  "name": "Bad Pixel Detector",
  "version": "0.1.0",
  "entry": "./index.js",
  "description": "Detect isolated hot/dead pixels in Bayer raw frames.",
  "frameKinds": ["bayer-frame"],
  "tools": [
    {
      "name": "scanBadPixels",
      "description": "Find isolated hot/dead pixels by comparing each extreme pixel with same-CFA neighbors.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "threshold": {
            "type": "number",
            "default": 400
          },
          "maxResults": {
            "type": "number",
            "default": 500
          }
        }
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "detections": {
            "type": "array"
          }
        }
      }
    }
  ]
}
```

Manifest 규칙:

- `id`는 lowercase kebab-case를 사용한다.
- `entry`는 manifest 파일 기준 상대 경로다.
- `frameKinds`는 tool이 처리 가능한 frame 종류를 적는다.
- `description`은 agent가 tool 선택에 사용할 수 있게 구체적으로 쓴다.
- schema는 완전한 JSON Schema가 아니어도 되지만, 최소한 type/default/required는 적는다.

## Entry Module Contract

entry module은 `registerPlugin(context)` 함수를 export한다.

```js
export function registerPlugin(context) {
  context.registerTool({
    name: "scanBadPixels",
    description: "Detect isolated hot/dead Bayer pixels using same-CFA neighbor comparison.",
    frameKinds: ["bayer-frame"],
    inputSchema: {
      type: "object",
      properties: {
        threshold: { type: "number", default: 400 },
        maxResults: { type: "number", default: 500 },
      },
    },
    run({ frame, tools, input }) {
      const detections = scanBadPixels(frame, input);

      tools.setOverlay({
        markers: detections.slice(0, 20).map((detection, index) => ({
          x: detection.x,
          y: detection.y,
          label: `B${index + 1}`,
        })),
      });

      return {
        detections,
        summary: {
          count: detections.length,
          strongest: detections[0] ?? null,
        },
      };
    },
  });
}
```

`run()`은 raw frame을 직접 수정하면 안 된다. 결과 overlay가 필요하면 `tools.setOverlay()`, `tools.addMarker()`, `tools.selectRegion()` 같은 viewer tool을 호출한다.

## Plugin Context

플러그인에 전달되는 `context`는 다음 형태를 목표로 한다.

```ts
type PluginContext = {
  registerTool(definition: ToolDefinition): void;
  viewerVersion: string;
};

type ToolDefinition = {
  name: string;
  description: string;
  frameKinds: string[];
  inputSchema: object;
  run(args: ToolRunArgs): ToolResult | Promise<ToolResult>;
};

type ToolRunArgs = {
  frame: BayerFrame | HdrFrame;
  state: ViewerState;
  input: Record<string, unknown>;
  tools: ViewerTools;
};
```

`ViewerTools`는 agent와 plugin이 공통으로 쓰는 viewer 조작 API다.

```ts
type ViewerTools = {
  getPixel(point: { x: number; y: number }): PixelSample;
  getPatch(roi: { x: number; y: number; width: number; height: number }): Patch;
  getRoiStats(roi: { x: number; y: number; width: number; height: number }): RoiStats;
  setViewMode(mode: string): void;
  setBrightness(multiplier: number): void;
  addMarker(marker: { x: number; y: number; label: string }): void;
  selectRegion(roi: { x: number; y: number; width: number; height: number }): void;
  zoomToRegion(roi: { x: number; y: number; width: number; height: number }): void;
  appendTrace(message: string): void;
};
```

## Algorithm Module Contract

알고리즘 자체는 UI와 분리한다. 가장 작은 형태는 순수 함수다.

```js
export function scanBadPixels(frame, options = {}) {
  const threshold = Number(options.threshold ?? 400);
  const maxResults = Number(options.maxResults ?? 500);

  // Return detections sorted by confidence score.
  return [];
}
```

권장 출력:

```json
{
  "x": 144,
  "y": 78,
  "type": "hot",
  "cfa": "R",
  "raw": 4095,
  "neighborMedian": 163,
  "score": 3918,
  "rank": 1
}
```

출력 규칙:

- 좌표는 image pixel coordinate를 사용한다.
- `rank`는 1부터 시작한다.
- `score`는 클수록 강한 후보로 해석한다.
- Bayer plugin은 `cfa` 값을 가능하면 포함한다.
- 디버깅 가능한 중간값을 출력에 포함한다. 예: `neighborMedian`, `threshold`, `windowSize`.

## Registration Steps For Humans

새 알고리즘을 추가할 때는 아래 순서로 진행한다.

1. 알고리즘을 `src/algorithms/<name>.js`에 순수 함수로 작성한다.
2. 입력 frame contract를 문서화한다. 예: `bayer-frame` only.
3. 출력 detection/result shape를 문서화한다.
4. `src/main.js`에서 임시로 import해서 `window.LEapsViewer.<toolName>`에 노출한다.
5. 필요하면 toolbar 또는 side panel에 버튼을 추가한다.
6. overlay, marker, zoom 동작을 연결한다.
7. fixture나 synthetic sample을 만든다.
8. `npm run build`와 관련 verify script를 실행한다.
9. 잘 동작하면 `plugins/<id>/plugin.json`과 `index.js` 형태로 승격한다.

## Instructions For Agents

새 plugin을 구현하는 agent는 다음 규칙을 지킨다.

- 먼저 `AGENTS.md`의 coordinate rules와 Bayer data contract를 읽는다.
- 기존 raw frame을 수정하지 않는다.
- 알고리즘은 UI 코드에 바로 섞지 말고 module로 분리한다.
- tool 이름은 동사로 시작한다. 예: `scanBadPixels`, `estimateNoise`, `findClippedRegions`.
- tool description에는 언제 쓰면 좋은지와 어떤 frame이 필요한지 적는다.
- 결과는 사람이 읽는 summary와 agent가 읽는 structured result를 둘 다 제공한다.
- overlay label은 짧게 유지한다. 예: `B1`, `H1`, `D1`.
- 긴 계산은 나중에 Web Worker로 옮길 수 있게 순수 함수 형태를 유지한다.
- 구현 후 `npm run build`를 실행한다.

## UI Exposure

플러그인은 두 방식으로 노출될 수 있다.

Toolbar action:

```html
<button
  class="tool-button"
  type="button"
  data-agent-action="run-plugin:bad-pixel.scanBadPixels"
  aria-label="Find bad pixels"
  title="Find bad pixels"
>
  <span>Bad Pixels</span>
</button>
```

Browser global API:

```js
window.LEapsViewer.plugins = {
  listTools,
  runTool,
};

await window.LEapsViewer.plugins.runTool("bad-pixel.scanBadPixels", {
  threshold: 400,
  maxResults: 500,
});
```

Agent가 UI를 조작할 때는 text label보다 `data-agent-action`을 우선 사용한다.

## Trace Contract

agent-visible trace는 내부 chain-of-thought가 아니라, 재현 가능한 관찰과 action log만 담는다.

좋은 trace:

```text
Loaded bad-pixel sample: 1024x512 RGGB 12-bit.
Scanning hot/dead extremes with threshold=400.
Compared candidates against same-CFA 5x5 neighbors.
Found 121 candidates; showing top 7 matched detections.
Zoomed to B1 at x=144, y=78.
```

피해야 할 trace:

```text
I feel this is probably a bad pixel.
The model thinks this area looks suspicious.
```

## Offline Scripts

`.mjs`, `.py`, `.exe`는 plugin 본체가 아니라 supporting tool로 본다.

사용 예:

- synthetic raw 생성
- fixture 변환
- regression report 생성
- 대용량 파일 전처리

offline script 결과는 반드시 재현 가능해야 한다. 입력 파일, 출력 파일, 주요 파라미터를 README나 metadata에 남긴다.

## Validation Checklist

플러그인을 추가한 뒤 확인할 것:

- `npm run build`가 통과한다.
- Bayer frame에서 좌표가 뒤집히지 않는다.
- `bitDepth`, `blackLevel`, `whiteLevel`을 하드코딩하지 않는다.
- RGGB/BGGR/GRBG/GBRG 차이를 고려한다.
- 결과가 score 순으로 정렬된다.
- overlay marker가 실제 image coordinate에 찍힌다.
- agent API에서 같은 결과를 얻을 수 있다.
- trace가 관찰, 도구 호출, 결과를 설명한다.
- false positive와 limitation을 문서에 남긴다.

## Bad Pixel Plugin Example

Bad pixel plugin의 최소 동작은 다음과 같다.

1. `frame.kind === "bayer-frame"`인지 확인한다.
2. `whiteLevel` 근처 픽셀을 hot 후보로 본다.
3. `blackLevel` 근처 픽셀을 dead 후보로 본다.
4. 같은 CFA 위치의 5x5 neighbor와 비교한다.
5. 현재 픽셀과 neighbor median 차이가 threshold 이상이면 후보로 둔다.
6. 주변 8-neighbor도 같이 extreme이면 장면 구조나 saturation region일 수 있으므로 제외한다.
7. score 순으로 정렬한다.
8. 상위 후보를 marker와 ROI overlay로 표시한다.
9. structured result를 반환한다.

예상 결과:

```json
{
  "tool": "bad-pixel.scanBadPixels",
  "summary": {
    "candidateCount": 121,
    "displayedCount": 7
  },
  "detections": [
    {
      "x": 144,
      "y": 78,
      "type": "hot",
      "cfa": "R",
      "raw": 4095,
      "neighborMedian": 163,
      "score": 3918,
      "rank": 1
    }
  ]
}
```

## Migration Path

현재 직접 연결된 `BadPx` 기능을 진짜 플러그인으로 바꾸려면 다음 순서로 진행한다.

1. `findBadPixels()`를 `src/algorithms/badPixel.js`로 이동한다.
2. `runBadPixelScanDemo()`는 알고리즘을 직접 호출하지 말고 tool registry를 통해 호출한다.
3. `window.LEapsViewer.findBadPixels()`는 compatibility wrapper로 남긴다.
4. `plugins/bad-pixel/plugin.json`을 만든다.
5. `plugins/bad-pixel/index.js`에서 `registerPlugin()`을 구현한다.
6. `src/pluginRuntime/registry.js`를 만들어 tool 등록, 목록 조회, 실행을 관리한다.
7. UI의 `Find Bad Pixels` 버튼은 `runTool("bad-pixel.scanBadPixels")`를 호출한다.

이렇게 바꾸면 LLM agent는 알고리즘 내부 구현을 모르더라도 tool 설명과 schema만 보고 적절한 검사를 선택할 수 있다.
