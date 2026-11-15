import assert from "node:assert/strict";
import test from "node:test";
import { checkComposition, validateRenderConfig } from "./render-film.mjs";

const film = { fps: 24, width: 1920, height: 1080, totalFrames: 480,
  shots: [{ id: "scene-001", seconds: 20, startFrame: 0, endFrame: 480, frames: 480 }] };

const composition = { id: "scene-001", duration: 20, width: 1920, height: 1080, hasTimeline: true };

test("checkComposition accepts matching metadata and timeline", () => {
  assert.deepEqual(checkComposition(composition, film.shots[0], film), []);
});

test("checkComposition reports a missing composition root", () => {
  assert.deepEqual(
    checkComposition({ ...composition, id: undefined, hasTimeline: false }, film.shots[0], film),
    ["data-composition-id root missing"],
  );
});

test("checkComposition reports a missing GSAP timeline", () => {
  assert.deepEqual(
    checkComposition({ ...composition, hasTimeline: false }, film.shots[0], film),
    ['no GSAP timeline registered under "scene-001"'],
  );
});

test("checkComposition reports duration mismatches", () => {
  assert.deepEqual(
    checkComposition({ ...composition, duration: 12 }, film.shots[0], film),
    ["data-duration 12 (expected 20)"],
  );
});

test("checkComposition reports dimension mismatches", () => {
  assert.deepEqual(
    checkComposition({ ...composition, width: 1080, height: 1920 }, film.shots[0], film),
    ["data-width 1080 (expected 1920)", "data-height 1920 (expected 1080)"],
  );
});

test("validateRenderConfig accepts a valid 24 FPS timeline", () => {
  assert.equal(validateRenderConfig(film), true);
});

for (const fps of [23, 25, 30, 60]) {
  test(`validateRenderConfig rejects ${fps} FPS`, () => {
    assert.throws(() => validateRenderConfig({ ...film, fps }), /24 FPS only/);
  });
}

for (const dimension of ["width", "height"]) {
  test(`validateRenderConfig rejects ${dimension} above 3840`, () => {
    assert.throws(() => validateRenderConfig({ ...film, [dimension]: 3841 }), /Canvas exceeds renderer limit/);
  });

  test(`validateRenderConfig accepts ${dimension} exactly 3840`, () => {
    assert.equal(validateRenderConfig({ ...film, [dimension]: 3840 }), true);
  });
}

test("validateRenderConfig accepts both dimensions exactly 3840", () => {
  assert.equal(validateRenderConfig({ ...film, width: 3840, height: 3840 }), true);
});

test("validateRenderConfig delegates missing timeline validation", () => {
  assert.throws(() => validateRenderConfig(null), /Invalid timeline/);
});

test("validateRenderConfig delegates empty shots validation", () => {
  assert.throws(() => validateRenderConfig({ ...film, shots: [] }), /Invalid timeline/);
});

test("validateRenderConfig delegates shot continuity validation", () => {
  const shots = [{ ...film.shots[0], startFrame: 1 }];
  assert.throws(() => validateRenderConfig({ ...film, shots }), /Noncontiguous timeline/);
});

test("validateRenderConfig delegates total frame validation", () => {
  assert.throws(() => validateRenderConfig({ ...film, totalFrames: 481 }), /Total frame mismatch/);
});
