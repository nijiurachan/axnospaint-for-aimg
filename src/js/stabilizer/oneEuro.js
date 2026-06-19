// @description Stage 2: ストローク平滑化
//
// 位置: 1€フィルタ (時間基準)
// 筆圧: 窓5メディアン → 空間LPF (波長 λ = stabilizer 値 [px])
// 補間: 確定点間隔 > gapPx で線形補間
//
// 1€ 参照: Casiez et al. (2012) "1€ Filter: A Simple Speed-based Low-pass Filter
// for Noisy Input in Interactive Systems"

// 1ポール時間LPF α 係数 (cutoff Hz, dt 秒)
function timeLowPassAlpha(cutoff, dt) {
    const tau = 1.0 / (2.0 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
}

class LowPass {
    constructor() { this.y = null; }
    reset() { this.y = null; }
    filter(x, alpha) {
        if (this.y === null) this.y = x;
        else this.y = alpha * x + (1 - alpha) * this.y;
        return this.y;
    }
    last() { return this.y; }
}

// 窓5の causal なランニング・メディアン
class Median5 {
    constructor() { this.buf = []; }
    reset() { this.buf = []; }
    push(x) {
        this.buf.push(x);
        if (this.buf.length > 5) this.buf.shift();
        const sorted = [...this.buf].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length / 2)];
    }
}

// 空間1ポールLPF: α = ds / (λ + ds)。ds=0 → α=0 (保持)、λ=0 → α=1 (素通し)
class SpatialLowPass {
    constructor() { this.y = null; }
    reset() { this.y = null; }
    filter(x, ds, lambda) {
        if (this.y === null) { this.y = x; return this.y; }
        if (lambda <= 0) { this.y = x; return this.y; }
        const a = ds / (lambda + ds);
        this.y = a * x + (1 - a) * this.y;
        return this.y;
    }
}

// スライダー値 (0-10) → 内部パラメータ
function mapStabilizerToParams(v) {
    const vClamped = Math.max(0, Math.min(10, v));
    // 位置: 0 → ほぼ素通し (min_cutoff=30Hz), 10 → 強く平滑 (1.0Hz)
    const min_cutoff = 30.0 * Math.pow(0.45, vClamped);
    const beta = 0.05;
    // 筆圧: 空間LPFの波長 (px)。0=素通し、10=波長10px
    const pressureLambda = vClamped;
    return { min_cutoff, beta, pressureLambda };
}

export class OneEuroStabilizer {
    constructor() {
        this.xPos = new LowPass();
        this.yPos = new LowPass();
        this.dxFilt = new LowPass();
        this.dyFilt = new LowPass();
        this.pressMed = new Median5();
        this.pressLpf = new SpatialLowPass();
        this.prevT = null;
        this.prevX = null;
        this.prevY = null;
        this.prevFiltX = null;
        this.prevFiltY = null;
        this.cumDist = 0; // ストローク開始からの累積距離 (筆圧 LPF の起動遅延に使用)
        this.lastCommitted = null;
        this.params = mapStabilizerToParams(0);
        this.d_cutoff = 1.0;
        // ペンごとに調節できるピクセル単位パラメータ (StrokePipeline 経由で設定)
        this.startPx = 2.0;  // 開幕この距離までは筆圧 LPF を素通し
        // 終端ハライ/ハネ (速度依存・筆圧テーパー)。configure で設定。
        this.enableFlickTaper = false;
        this.flickTaper = null;
        this.zoom = 1.0;
        this.brushWidth = 1.0;
        this.recent = []; // 直近のフィルタ後点 {x,y,t} (リリース速度/方向の算出用)
        this.confirmed = []; // ストローク中に emit した確定点 (内挿テーパー再描画用)
        this._rebuild = null; // 終端テーパー後の全点リスト (consumeRebuild で取り出す)
    }

    // ストローク開始時に一括設定する。
    // stabilizerValue: 0-10 スライダー値 / startPx: px 単位
    // flickTaper/zoom/brushWidth/enableFlickTaper: 終端ハライ用
    configure({ stabilizerValue = 0, startPx = 2.0,
        flickTaper = null, zoom = 1.0, brushWidth = 1.0, enableFlickTaper = false } = {}) {
        this.params = mapStabilizerToParams(stabilizerValue);
        this.startPx = startPx;
        this.flickTaper = flickTaper;
        this.zoom = (zoom > 0) ? zoom : 1.0;
        this.brushWidth = (brushWidth > 0) ? brushWidth : 1.0;
        this.enableFlickTaper = enableFlickTaper && !!flickTaper;
    }

    _filterPoint(raw) {
        const { x, y, pressure, t } = raw;
        const dt = (this.prevT === null) ? (1.0 / 60.0) : Math.max(0.001, (t - this.prevT) / 1000.0);

        // 筆圧: 窓5メディアン → 空間LPF
        const pMed = this.pressMed.push(pressure);

        if (this.prevT === null) {
            // 初回サンプル: フィルタ初期化
            this.xPos.filter(x, 1);
            this.yPos.filter(y, 1);
            this.dxFilt.filter(0, 1);
            this.dyFilt.filter(0, 1);
            this.pressLpf.filter(pMed, 0, 0);
            this.prevT = t;
            this.prevX = x;
            this.prevY = y;
            this.prevFiltX = x;
            this.prevFiltY = y;
            this._pushRecent(x, y, t);
            return { x, y, pressure: pMed, t };
        }

        // 位置: 1€フィルタ (時間基準)
        const dx = (x - this.prevX) / dt;
        const dy = (y - this.prevY) / dt;
        const aD = timeLowPassAlpha(this.d_cutoff, dt);
        const dxHat = this.dxFilt.filter(dx, aD);
        const dyHat = this.dyFilt.filter(dy, aD);
        const speed = Math.hypot(dxHat, dyHat);
        const cutoff = this.params.min_cutoff + this.params.beta * speed;
        const aP = timeLowPassAlpha(cutoff, dt);
        const xHat = this.xPos.filter(x, aP);
        const yHat = this.yPos.filter(y, aP);

        // 筆圧: 空間LPF (フィルタ後の位置を基準に進行距離を測る)
        const ds = Math.hypot(xHat - this.prevFiltX, yHat - this.prevFiltY);
        this.cumDist += ds;
        let pHat;
        // ストローク開始 startPx は LPF を素通し: ペンタブ初動の段付きを残すと
        // 高筆圧の書き出しが入らないため、生の median をそのまま採用しつつ
        // LPF 状態は追従させておく (startPx 通過後に滑らかに引き継ぐ)。
        if (this.cumDist < this.startPx) {
            pHat = pMed;
            this.pressLpf.y = pMed;
        } else {
            pHat = this.pressLpf.filter(pMed, ds, this.params.pressureLambda);
        }

        this.prevT = t;
        this.prevX = x;
        this.prevY = y;
        this.prevFiltX = xHat;
        this.prevFiltY = yHat;

        this._pushRecent(xHat, yHat, t);
        return { x: xHat, y: yHat, pressure: pHat, t };
    }

    // 直近のフィルタ後点を保持 (リリース速度/方向の算出用に最大6点)
    _pushRecent(x, y, t) {
        this.recent.push({ x, y, t });
        if (this.recent.length > 6) this.recent.shift();
    }

    onStart(raw) {
        this.xPos.reset();
        this.yPos.reset();
        this.dxFilt.reset();
        this.dyFilt.reset();
        this.pressMed.reset();
        this.pressLpf.reset();
        this.prevT = null;
        this.prevX = null;
        this.prevY = null;
        this.prevFiltX = null;
        this.prevFiltY = null;
        this.cumDist = 0;
        this.lastCommitted = null;
        this.recent = [];
        this.confirmed = [];
        this._rebuild = null;

        const fp = this._filterPoint(raw);
        this.lastCommitted = fp;
        this.confirmed.push(fp);
        return [fp];
    }

    onMove(raw, gapPx) {
        if (this.lastCommitted === null) return this.onStart(raw);
        const fp = this._filterPoint(raw);
        return this._emit(fp, gapPx);
    }

    onEnd(raw, gapPx) {
        // pointerup は筆圧0 を報告しがち。終端サンプルは位置のみ採用し、
        // 筆圧は直前の確定値を引き継いで median を汚さない (末端が不自然に細るのを防ぐ)。
        const endRaw = (this.lastCommitted !== null)
            ? { ...raw, pressure: this.lastCommitted.pressure }
            : raw;
        const fp = this._filterPoint(endRaw);
        if (this.lastCommitted === null) {
            this.lastCommitted = fp;
            this.confirmed.push(fp);
            return [fp];
        }
        const out = this._emit(fp, gapPx);
        // 終端ハライ/ハネ: リリース速度がしきい値を超えたら、既存ストローク終端へ
        // 食い込む内挿テーパー＋進行方向への外挿テーパーを付与し、全点再描画用リストを作る。
        this._rebuild = null;
        if (this.enableFlickTaper) {
            this._rebuild = this._buildFlickTaper(gapPx);
        }
        return out;
    }

    // 終端テーパー後の全確定点リストを取り出す (取り出し後はクリア)。
    // null = テーパー無し (通常の逐次描画でよい)。
    consumeRebuild() {
        const r = this._rebuild;
        this._rebuild = null;
        return r;
    }

    // 終端ハライ/ハネ・テーパー: 内挿(既存終端へ食い込み)＋外挿(進行方向へ延長)。
    // 条件を満たせば「全確定点(終端は筆圧上書き済み) + 外挿点」のリストを返す。満たさなければ null。
    _buildFlickTaper(gapPx) {
        const ft = this.flickTaper;
        const pts = this.confirmed;
        if (!ft || pts.length < 2 || this.recent.length < 2) return null;

        // 直近 ~24ms (最低2点) の窓で リリース方向(フィルタ後で安定) と 速度 v[px/ms] を算出
        const last = this.recent[this.recent.length - 1];
        let ri = this.recent.length - 2;
        while (ri > 0 && (last.t - this.recent[ri].t) < 24) ri--;
        const ref = this.recent[ri];
        const rdx = last.x - ref.x;
        const rdy = last.y - ref.y;
        const rdist = Math.hypot(rdx, rdy);
        const rdt = Math.max(1, last.t - ref.t);
        if (rdist < 1e-3) return null; // 方向不定 (静止) はハライ無し
        const v = rdist / rdt; // canvas px/ms
        const ux = rdx / rdist;
        const uy = rdy / rdist;

        // ハライ判定速度 (高ズームでは閾値を下げる: Z^-0.5)
        const threshold = ft.thresholdBase * Math.pow(this.zoom, -0.5);
        if (v <= threshold) return null;

        // テーパ長: 速度依存。下限=幅×min倍率、上限=(幅+4)×max倍率 (細ペンでもハライ出るよう+4)
        const minT = this.brushWidth * ft.minTaperRatio;
        const maxT = (this.brushWidth + 4) * ft.maxTaperRatio;
        const taperDist = Math.min(Math.max(v * ft.taperFactor, minT), maxT);
        const extrapRatio = Math.min(Math.max(ft.extrapRatio, 0), 0.8);
        const extrapDist = taperDist * extrapRatio;
        const interpDist = taperDist * (1 - extrapRatio);

        // バックトラック: 終点から遡り、内挿テーパ開始点を決める。
        // 終了条件: 「局所速度 < v/2 を2点連続」 または 「遡及距離が interpDist 到達」。
        const n = pts.length;
        let startIdx = n - 1;
        let acc = 0; // 実内挿テーパ距離
        let lowCount = 0;
        for (let i = n - 1; i >= 1; i--) {
            const a = pts[i - 1];
            const b = pts[i];
            const segDist = Math.hypot(b.x - a.x, b.y - a.y);
            const segDt = Math.max(1, b.t - a.t);
            const vi = segDist / segDt;
            if (vi < v * 0.5) lowCount++; else lowCount = 0;
            if (acc + segDist > interpDist) { startIdx = i; break; }
            acc += segDist;
            startIdx = i - 1;
            if (lowCount >= 2) break;
        }
        const actualInterpDist = acc;
        const span = actualInterpDist + extrapDist;
        if (span <= 1e-3) return null; // テーパー区間が無い

        // 筆圧テーパー: 開始点筆圧 P0 をベースに、span にわたり 0 へ線形ランプ。
        const P0 = pts[startIdx].pressure;
        let distFromStart = 0;
        for (let i = startIdx; i < n; i++) {
            if (i > startIdx) {
                distFromStart += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
            }
            const ramp = Math.max(0, 1 - distFromStart / span);
            pts[i] = { ...pts[i], pressure: P0 * ramp };
        }

        // 外挿点: 終点から進行方向へ gap 間隔で extrapDist ぶん追加 (終端で筆圧0)。
        const endPt = pts[n - 1];
        const gap = (gapPx && gapPx > 0) ? gapPx : 6.0;
        const out = pts.slice();
        if (extrapDist > 1e-3) {
            const steps = Math.max(1, Math.ceil(extrapDist / gap));
            for (let s = 1; s <= steps; s++) {
                const dd = extrapDist * s / steps;
                const ramp = Math.max(0, 1 - (actualInterpDist + dd) / span);
                out.push({
                    x: endPt.x + ux * dd,
                    y: endPt.y + uy * dd,
                    pressure: P0 * ramp,
                    t: endPt.t,
                });
            }
        }
        return out;
    }

    // 確定点を出力 (必要なら線形補間で挿入)
    _emit(fp, gapPx) {
        const out = [];
        const prev = this.lastCommitted;
        const dist = Math.hypot(fp.x - prev.x, fp.y - prev.y);
        const gap = (gapPx && gapPx > 0) ? gapPx : 6.0;

        if (dist > gap) {
            const n = Math.max(1, Math.ceil(dist / gap));
            for (let i = 1; i < n; i++) {
                const tt = i / n;
                out.push({
                    x: prev.x + (fp.x - prev.x) * tt,
                    y: prev.y + (fp.y - prev.y) * tt,
                    pressure: prev.pressure + (fp.pressure - prev.pressure) * tt,
                    t: prev.t + (fp.t - prev.t) * tt,
                });
            }
        }
        out.push(fp);
        this.lastCommitted = fp;
        for (const p of out) this.confirmed.push(p);
        return out;
    }
}
