// @description 投稿処理

import { UTIL, dispDate } from './etc.js';
import htmldata from '../html/post.txt';
// css適用
import '../css/post.css';

// 設定機能制御オブジェクト
export class PostSystem {
    axpObj;
    // 投稿メニューのサムネイル表示のサイズ
    CONST = {
        X_POST_MAX: 120,
        Y_POST_MAX: 120,
    }
    // お題枠のレイアウト定義（合成後の全体サイズに対する比率）
    ODAI = {
        MARGIN: 0.0375,         // 左右余白
        LINE: 0.005,            // 枠線の太さ
        TITLE_BOTTOM: 0.0775,   // タイトル領域の下端
        BANNER_TOP: 0.0775,     // 黒帯の上端
        BANNER_BOTTOM: 0.1375,  // 黒帯の下端
        BOX_TOP: 0.145,         // 枠の上端
        BOX_BOTTOM: 0.9075,     // 枠の下端
        TITLE_FONT: 0.05,       // タイトルのフォントサイズ
        BANNER_FONT: 0.042,     // 黒帯テキストのフォントサイズ
        CORNER_FONT: 0.03,      // 右下テキストのフォントサイズ
        CORNER_BASELINE: 0.985, // 右下テキストのベースライン位置
        FONT_FAMILY: "'Hiragino Kaku Gothic ProN','Hiragino Sans','Yu Gothic','Meiryo',sans-serif",
    }
    // お題絵モードの切り取り設定
    odaiCrop = {
        scale: 1.0, // 切り取る正方形のサイズ（短辺に対する比率 0.1～1）
        rateX: 0.5, // 切り取り横位置（0～1）
        rateY: 0.5, // 切り取り縦位置（0～1）
    }
    CANVAS = {
        post: null,
        post_ctx: null,
        thumbnail: null,
        thumbnail_ctx: null,
    }
    constructor(axpObj) {
        this.axpObj = axpObj;
    }
    // 初期化
    init() {
        // HTML
        let targetElement = document.getElementById('axp_post');
        targetElement.insertAdjacentHTML('afterbegin', this.axpObj.translateHTML(htmldata));
        // CANVAS
        this.CANVAS.post = document.getElementById('axp_post_canvas_postingImage');
        this.CANVAS.post_ctx = this.CANVAS.post.getContext('2d');
        this.CANVAS.thumbnail = document.getElementById('axp_post_canvas_thumbnail');
        this.CANVAS.thumbnail_ctx = this.CANVAS.thumbnail.getContext('2d');
        // お題絵テキストの初期値（保存済みのユーザー設定があれば後段のrestoreConfigで上書きされる）
        document.getElementById('axp_post_text_odaiTitle').value = this.axpObj._('@POST.ODAI.DEFAULT_TITLE');
        document.getElementById('axp_post_text_odaiBanner').value = this.axpObj._('@POST.ODAI.DEFAULT_BANNER');
        document.getElementById('axp_post_text_odaiCorner').value = this.axpObj._('@POST.ODAI.DEFAULT_CORNER');
    }
    resetCanvas() {
        // モードに応じたUI表示切替
        this.updateOdaiUI();
        // 投稿画像のサイズ
        let x;
        let y;
        if (this.axpObj.odaiMode) {
            // お題絵モード：お題枠合成後のサイズ
            // 切り取り設定を初期化（サイズ全体・中央）
            this.odaiCrop.scale = 1.0;
            this.odaiCrop.rateX = 0.5;
            this.odaiCrop.rateY = 0.5;
            const layout = this.getOdaiLayout();
            x = layout.total;
            y = layout.total;
            this.updateOdaiCropUI();
        } else {
            x = this.axpObj.x_size;
            y = this.axpObj.y_size;
        }
        this.setPostCanvasSize(x, y);
    }
    // 投稿キャンバスとサムネイルのサイズ設定（切り取り設定は変更しない）
    setPostCanvasSize(x, y) {
        // 投稿キャンバス
        this.CANVAS.post.width = x;
        this.CANVAS.post.height = y;
        this.CANVAS.post_ctx.clearRect(0, 0, x, y);

        let thumbnail_x;
        let thumbnail_y;
        // 投稿キャンバス サムネイル
        if (x > 120 || y > 120) {
            // 縮小率を計算してキャンバスサイズに反映
            const sc = this.CONST.X_POST_MAX / Math.max(x, y);
            thumbnail_x = Math.round(x * sc);
            thumbnail_y = Math.round(y * sc);
        } else {
            thumbnail_x = x;
            thumbnail_y = y;
        }
        this.CANVAS.thumbnail.width = thumbnail_x;
        this.CANVAS.thumbnail.height = thumbnail_y;
        this.CANVAS.thumbnail_ctx.clearRect(0, 0, thumbnail_x, thumbnail_y);

        // キャンバスサイズの表示
        let sizeText = `${this.axpObj._('@COMMON.WIDTH')}:${x} ${this.axpObj._('@COMMON.HEIGHT')}:${y}`;
        if (this.axpObj.odaiMode) {
            sizeText += ` (${this.axpObj._('@POST.ODAI.FRAMED')})`;
        }
        document.getElementById('axp_post_span_imageSize').textContent = sizeText;
    }
    // お題枠のレイアウト計算（合成後の各部の位置とサイズ）
    getOdaiLayout() {
        const R = this.ODAI;
        // 絵から切り取る正方形の一辺
        const side = this.getOdaiCropRect().size;
        // 切り取った絵を等倍（リサンプリングなし）で枠内に収めるため、
        // 各部品のピクセルサイズを先に確定し、その合計から全体サイズを導出する
        // （全体サイズからの丸め逆算では innerH と side に1px単位の不一致が生じるため）
        const innerRate = R.BOX_BOTTOM - R.BOX_TOP - R.LINE * 2;
        // 全体サイズの理論値
        const ideal = side / innerRate;
        const margin = Math.round(ideal * R.MARGIN);
        const line = Math.max(1, Math.round(ideal * R.LINE));
        const boxTop = Math.round(ideal * R.BOX_TOP);
        // 枠内の描画領域の高さ === side を厳密に保証する
        const boxBottom = boxTop + side + line * 2;
        const total = boxBottom + Math.round(ideal * (1 - R.BOX_BOTTOM));
        return {
            side: side,
            total: total,
            margin: margin,
            line: line,
            bannerTop: Math.round(ideal * R.BANNER_TOP),
            bannerBottom: Math.round(ideal * R.BANNER_BOTTOM),
            boxTop: boxTop,
            boxBottom: boxBottom,
            // 枠内の描画領域
            innerX: margin + line,
            innerY: boxTop + line,
            innerW: total - (margin + line) * 2,
            innerH: side,
        };
    }
    // 絵から切り取る正方形の領域
    getOdaiCropRect() {
        const w = this.axpObj.x_size;
        const h = this.axpObj.y_size;
        const maxSize = Math.min(w, h);
        // 極小化を防ぐため、最小キャンバスサイズを下限とする
        const size = Math.min(maxSize, Math.max(this.axpObj.CONST.CANVAS_X_MIN, Math.round(maxSize * this.odaiCrop.scale)));
        return {
            x: Math.round((w - size) * this.odaiCrop.rateX),
            y: Math.round((h - size) * this.odaiCrop.rateY),
            size: size,
        };
    }
    // お題絵モードのUI表示更新（一時保存データの復元によるモード切替にも追従する）
    updateOdaiUI() {
        const isOdai = this.axpObj.odaiMode;
        if (isOdai) {
            UTIL.show('axp_post_div_odai');
        } else {
            UTIL.hide('axp_post_div_odai');
        }
        // お題絵は白地で投稿されるため、透過は選択不可
        const input_transparent = document.querySelectorAll("input[name=axp_post_radio_bg]");
        for (let element of input_transparent) {
            element.disabled = isOdai;
        }
    }
    // 切り取りスライダーの表示更新（動かす余地のない軸の位置スライダーは無効化）
    updateOdaiCropUI() {
        const crop = this.getOdaiCropRect();
        const sliderSize = document.getElementById('axp_post_range_odaiCropSize');
        const sliderX = document.getElementById('axp_post_range_odaiCropX');
        const sliderY = document.getElementById('axp_post_range_odaiCropY');
        sliderSize.value = Math.round(this.odaiCrop.scale * 100);
        sliderX.value = Math.round(this.odaiCrop.rateX * 100);
        sliderY.value = Math.round(this.odaiCrop.rateY * 100);
        sliderX.disabled = (crop.size >= this.axpObj.x_size);
        sliderY.disabled = (crop.size >= this.axpObj.y_size);
    }
    // お題枠に合成した投稿キャンバスの描画
    drawOdaiPostCanvas() {
        const R = this.ODAI;
        const layout = this.getOdaiLayout();
        const total = layout.total;
        const ctx = this.CANVAS.post_ctx;

        // キャンバスサイズが合成後のサイズと一致していない場合に再設定（切り取りサイズ変更時など）
        if (this.CANVAS.post.width !== total || this.CANVAS.post.height !== total) {
            this.setPostCanvasSize(total, total);
        }

        // 白背景
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, total, total);

        // タイトル（上部テキスト）
        const titleText = document.getElementById('axp_post_text_odaiTitle').value;
        ctx.fillStyle = '#000000';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `bold ${Math.max(1, Math.round(total * R.TITLE_FONT))}px ${R.FONT_FAMILY}`;
        ctx.fillText(titleText, Math.round(total / 2), Math.round(total * R.TITLE_BOTTOM / 2), total - layout.margin * 2);

        // 黒帯
        ctx.fillRect(layout.margin, layout.bannerTop, total - layout.margin * 2, layout.bannerBottom - layout.bannerTop);

        // 黒帯テキスト（お題）
        const bannerText = document.getElementById('axp_post_text_odaiBanner').value;
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${Math.max(1, Math.round(total * R.BANNER_FONT))}px ${R.FONT_FAMILY}`;
        ctx.fillText(bannerText, Math.round(total / 2), Math.round((layout.bannerTop + layout.bannerBottom) / 2), total - layout.margin * 4);

        // 枠線
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = layout.line;
        ctx.strokeRect(
            layout.margin + layout.line / 2,
            layout.boxTop + layout.line / 2,
            total - layout.margin * 2 - layout.line,
            layout.boxBottom - layout.boxTop - layout.line);

        // 絵（正方形に切り取って枠内にセンタリング）
        const crop = this.getOdaiCropRect();
        const dest = layout.innerH;
        const dx = layout.innerX + Math.round((layout.innerW - dest) / 2);
        ctx.drawImage(
            this.axpObj.layerSystem.CANVAS.backscreen_white,
            crop.x, crop.y, crop.size, crop.size,
            dx, layout.innerY, dest, dest);

        // 右下テキスト
        const cornerText = document.getElementById('axp_post_text_odaiCorner').value;
        ctx.fillStyle = '#000000';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'alphabetic';
        ctx.font = `bold ${Math.max(1, Math.round(total * R.CORNER_FONT))}px ${R.FONT_FAMILY}`;
        ctx.fillText(cornerText, total - layout.margin, Math.round(total * R.CORNER_BASELINE), total - layout.margin * 2);

        // サムネイル
        this.CANVAS.thumbnail_ctx.fillStyle = '#ffffff';
        this.CANVAS.thumbnail_ctx.fillRect(0, 0, this.CANVAS.thumbnail.width, this.CANVAS.thumbnail.height);
        this.CANVAS.thumbnail_ctx.drawImage(
            this.CANVAS.post,
            0,
            0,
            this.CANVAS.thumbnail.width,
            this.CANVAS.thumbnail.height);
    }
    startEvent() {
        // 投稿フォームのカスタマイズ
        // 投稿フォーム
        if (!this.axpObj.postForm.input.isDisplay) {
            UTIL.hide('axp_post_div_input');
            // 入力必須の無効化
            this.axpObj.postForm.input.strName.isInputRequired = false;
            this.axpObj.postForm.input.strTitle.isInputRequired = false;
            this.axpObj.postForm.input.strMessage.isInputRequired = false;
        } else {
            // 投稿者名
            if (!this.axpObj.postForm.input.strName.isDisplay) {
                UTIL.hide(document.querySelector('.axpc_post_name_property'));
                UTIL.hide('axp_post_text_name');
                this.axpObj.postForm.input.strName.isInputRequired = false;
            } else {
                // 最大文字数設定
                document.getElementById('axp_post_text_name').maxLength = this.axpObj.postForm.input.strName.maxLength;
                // プレースホルダー設定
                document.getElementById('axp_post_text_name').placeholder = this.axpObj.postForm.input.strName.placeholder;
                // 必須の文字表示
                if (this.axpObj.postForm.input.strName.isInputRequired) {
                    UTIL.show(document.querySelector('.axpc_post_name_required'));
                }
            }
            // タイトル
            if (!this.axpObj.postForm.input.strTitle.isDisplay) {
                UTIL.hide(document.querySelector('.axpc_post_title_property'));
                UTIL.hide('axp_post_text_title');
                this.axpObj.postForm.input.strTitle.isInputRequired = false;
            } else {
                // 最大文字数設定
                document.getElementById('axp_post_text_title').maxLength = this.axpObj.postForm.input.strTitle.maxLength;
                // プレースホルダー設定
                document.getElementById('axp_post_text_title').placeholder = this.axpObj.postForm.input.strTitle.placeholder;
                // 必須の文字表示
                if (this.axpObj.postForm.input.strTitle.isInputRequired) {
                    UTIL.show(document.querySelector('.axpc_post_title_required'));
                }
            }
            // 本文
            if (!this.axpObj.postForm.input.strMessage.isDisplay) {
                UTIL.hide(document.querySelector('.axpc_post_message_property'));
                UTIL.hide('axp_post_textarea_message');
                this.axpObj.postForm.input.strMessage.isInputRequired = false;
            } else {
                // 最大文字数設定
                document.getElementById('axp_post_textarea_message').maxLength = this.axpObj.postForm.input.strMessage.maxLength;
                // プレースホルダー設定
                document.getElementById('axp_post_textarea_message').placeholder = this.axpObj.postForm.input.strMessage.placeholder;
                // 必須の文字表示
                if (this.axpObj.postForm.input.strMessage.isInputRequired) {
                    UTIL.show(document.querySelector('.axpc_post_message_required'));
                }
            }
            // ウォッチリスト登録
            if (!this.axpObj.postForm.input.strWatchList.isDisplay) {
                UTIL.hide(document.querySelector('.axpc_post_watchList'));
            }
        }
        // 注意事項
        if (!this.axpObj.postForm.notice.isDisplay) {
            UTIL.hide('axp_post_div_notice');
        }

        // 透過
        let input_transparent = document.querySelectorAll("input[name=axp_post_radio_bg]");
        for (let element of input_transparent) {
            element.onchange = () => {
                this.axpObj.assistToolSystem.transparent();
                this.axpObj.drawPostCanvas();
            }
        }

        // お題絵モード
        // 表示の切替はupdateOdaiUIに集約（一時保存データの復元でモードが変わるため、
        // イベントはモードに関わらず登録しておく）
        this.updateOdaiUI();
        // 枠テキスト（入力時に保存して再描画）
        for (const id of ['axp_post_text_odaiTitle', 'axp_post_text_odaiBanner', 'axp_post_text_odaiCorner']) {
            const element = document.getElementById(id);
            element.oninput = () => {
                this.axpObj.configSystem.saveConfig(`VALUE_${id}`, element.value);
                this.axpObj.drawPostCanvas();
            }
        }
        // 切り取りサイズスライダー（サイズにより位置スライダーの有効/無効が変わるため表示も更新）
        document.getElementById('axp_post_range_odaiCropSize').oninput = (e) => {
            this.odaiCrop.scale = Number(e.target.value) / 100;
            this.updateOdaiCropUI();
            this.axpObj.drawPostCanvas();
        }
        // 切り取り位置スライダー（横・縦）
        document.getElementById('axp_post_range_odaiCropX').oninput = (e) => {
            this.odaiCrop.rateX = Number(e.target.value) / 100;
            this.axpObj.drawPostCanvas();
        }
        document.getElementById('axp_post_range_odaiCropY').oninput = (e) => {
            this.odaiCrop.rateY = Number(e.target.value) / 100;
            this.axpObj.drawPostCanvas();
        }
        // ボタン：枠なし画像をクリップボードにコピー
        document.getElementById('axp_post_button_odaiCopy').onclick = async () => {
            const elementMessage = document.getElementById('axp_post_span_message');
            try {
                if (!navigator.clipboard || !window.ClipboardItem) {
                    throw new Error('Clipboard API not supported');
                }
                const canvas = this.axpObj.layerSystem.CANVAS.backscreen_white;
                // Safari対応のため、Promise<Blob>を直接ClipboardItemに渡す
                const blobPromise = new Promise((resolve, reject) => {
                    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('toBlob failed')), 'image/png');
                });
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
                elementMessage.textContent = this.axpObj._('@POST.ODAI.INFO_COPIED');
            } catch (error) {
                console.log('error:', error);
                elementMessage.textContent = this.axpObj._('@POST.ODAI.INFO_COPY_FAILED');
            }
        }
        // ボタン：枠なし画像をダウンロード
        document.getElementById('axp_post_button_odaiDownload').onclick = () => {
            const link = document.createElement('a');
            link.href = this.axpObj.layerSystem.CANVAS.backscreen_white.toDataURL('image/png');
            link.download = 'ap' + dispDate(new Date(), 'YYYYMMDD_hhmmss') + '.png';
            link.click();
        }
        document.getElementById('axp_post_text_title').oninput = (e) => {
            let text = e.target.value;
            document.getElementById('axp_post_div_thumbnailTitle').textContent = text;
        }

        document.getElementById('axp_post_text_title').oninput = (e) => {
            let text = e.target.value;
            document.getElementById('axp_post_div_thumbnailTitle').textContent = text;
        }
        // ボタン：お絵カキコする！
        document.getElementById("axp_post_button_upload").onclick = () => {

            // 入力必須項目のチェック（起動オプションで必須項目に指定されている場合、一文字以上入力されていなければ処理を中断してメッセージを表示する）
            // 投稿者名
            if (this.axpObj.postForm.input.strName.isInputRequired) {
                if (document.getElementById('axp_post_text_name').value.trim().length < 1) {
                    document.getElementById('axp_post_span_message').textContent = `${this.axpObj._('@POST.INFO_REQUIRED')} ( ${this.axpObj._('@POST.NAME')} )`;
                    return;
                }
            }
            // タイトル
            if (this.axpObj.postForm.input.strTitle.isInputRequired) {
                if (document.getElementById('axp_post_text_title').value.trim().length < 1) {
                    document.getElementById('axp_post_span_message').textContent = `${this.axpObj._('@POST.INFO_REQUIRED')} ( ${this.axpObj._('@POST.TITLE')} )`;
                    return;
                }
            }
            // 本文
            if (this.axpObj.postForm.input.strMessage.isInputRequired) {
                if (document.getElementById('axp_post_textarea_message').value.trim().length < 1) {
                    document.getElementById('axp_post_span_message').textContent = `${this.axpObj._('@POST.INFO_REQUIRED')} ( ${this.axpObj._('@POST.MESSAGE')} )`;
                    return;
                }
            }

            // ボタン表示変更（投稿中）
            UTIL.hide('axp_post_button_upload_label');
            UTIL.show('axp_post_button_upload_loading');
            document.getElementById("axp_post_button_upload").disabled = true;

            // 長さのチェックはユーザー側が任意で行う仕様とする（AXNOS Paint側では行わない）
            // 画像のURLエンコーディング
            let strEncodeImg = this.CANVAS.post.toDataURL('image/png');

            // 送信用にヘッダ部分を削除
            strEncodeImg = strEncodeImg.replace('data:image/png;base64,', '');

            // 送信データオブジェクト
            let objPostData = {
                strName: document.getElementById('axp_post_text_name').value.trim(),
                strTitle: document.getElementById('axp_post_text_title').value.trim(),
                strMessage: document.getElementById('axp_post_textarea_message').value.trim(),
                strWatchList: (document.getElementById('axp_post_checkbox_watchList').checked) ? 't' : '',
                oekaki_id: this.axpObj.oekaki_id,
                draftImageFile: this.axpObj.draftImageFile,
                strEncodeImg: strEncodeImg,
            };

            (async () => {
                let result;
                try {
                    // 外部で定義された投稿用スクリプトを呼び出す
                    result = await this.axpObj.FUNCTION.post(objPostData);
                    if (result) {
                        console.log('お絵カキコ投稿情報送信');
                    }
                } catch (error) {
                    console.log('error:', error);
                } finally {
                    // ボタン表示変更（初期化）
                    UTIL.show('axp_post_button_upload_label');
                    UTIL.hide('axp_post_button_upload_loading');
                    document.getElementById("axp_post_button_upload").disabled = false;
                }
            })();
        }

        // ボタンラベル初期設定
        document.getElementById('axp_post_button_upload_label').textContent = this.axpObj._('@POST.BUTTON_SUBMIT');
    }
}