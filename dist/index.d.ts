/** AXNOS Paint 本体 */
export default class {
    static ver(): string
    constructor(params: AXNOSPaintConstructorParameters)
    version(): string
    on(): void
    off(): void
}

/** AXNOS Paint コンストラクタパラメータ */
export type AXNOSPaintConstructorParameters = {
    /** AXNOS Paintの画面を展開するdiv要素のid属性（必須） */
    bodyId: string
    /** キャンバスの最小サイズ（横）。単位はピクセル。最小8～最大1000。デフォルト: 8 */
    minWidth?: number
    /** キャンバスの最小サイズ（縦）。単位はピクセル。最小8～最大1000。デフォルト: 8 */
    minHeight?: number
    /** キャンバスの最大サイズ（横）。単位はピクセル。最小8～最大1000。デフォルト: 600 */
    maxWidth?: number
    /** キャンバスの最大サイズ（縦）。単位はピクセル。最小8～最大1000。デフォルト: 600 */
    maxHeight?: number
    /** キャンバスの初期サイズ（横）。単位はピクセル。デフォルト: 317 */
    width?: number
    /** キャンバスの初期サイズ（縦）。単位はピクセル。デフォルト: 317 */
    height?: number
    /** 下書き機能(1)で使用するPNG画像が配置されているURLパス名。URLパラメータoekaki_idと組み合わせて使用する。oekaki_id=12345の場合、`${oekakiURL}12345.png`がロードされる */
    oekakiURL?: string
    /** 下書き機能(2)で読み込む画像ファイルURL */
    draftImageFile?: string
    /** 下書き機能(1)(2)の画像読込タイムアウト時間。単位はミリ秒。デフォルト: 15000 */
    oekakiTimeout?: number
    /** 自動保存からの復元またはロード機能を使用する際、同一の掲示板の画像であるかをチェック。デフォルト: false */
    checkSameBBS?: boolean
    /** 下書き機能(1)または(2)の使用時に、キャンバスサイズの変更ができないように制限。デフォルト: false */
    restrictDraftCanvasResizing?: boolean
    /** 投稿タブを開けないようにする。デフォルト: false */
    restrictPost?: boolean
    /** ヘッダーのテキスト表示領域に表示する文字列。最大1024文字まで */
    headerText?: string
    /** ユーザーが任意で追加することができる拡張タブ定義 */
    expansionTab?: AXNOSPaintExpansionTab
    /** ユーザー辞書JSONファイル。nullを指定した場合、辞書ファイルを使用しない */
    dictionary?: string | null
    /** 投稿処理で呼び出すユーザー関数定義 */
    post?: (postObj: AXNOSPaintPostObject) => Promise<void>
    /** 投稿用フォームのユーザーカスタマイズ定義 */
    postForm?: AXNOSPaintPostForm
    /** デフォルト色設定 */
    defaultColor?: {
        /** 前景色 (デフォルト: #000000) */
        main: string
        /** 背景色 (デフォルト: #FFFFFF) */
        sub: string
        /** 初期カラーパレット (デフォルト: 黒〜白の24色) */
        palette: string[]
    }
}

/** 投稿情報オブジェクト */
export type AXNOSPaintPostObject = {
    /** 投稿者名。trim()済。入力がない場合は空文字 */
    strName: string
    /** タイトル。trim()済。入力がない場合は空文字 */
    strTitle: string
    /** 本文。trim()済。入力がない場合は空文字 */
    strMessage: string
    /** ウォッチリストに登録。チェックボックスが選択されている場合't'、それ以外は空文字 */
    strWatchList: string
    /** 下書き機能(1)を使用した場合に付与される情報。未使用時はnull */
    oekaki_id: string | null
    /** 下書き機能(2)を使用した場合に付与される情報。未使用時はnull */
    draftImageFile: string | null
    /** 投稿するpng画像のdata URI（'data:image/png;base64,'ヘッダ部分を削除済） */
    strEncodeImg: string
}

/** 投稿用フォームのカスタマイズ定義 */
export type AXNOSPaintPostForm = {
    /** 投稿フォーム設定 */
    input?: {
        /** 項目表示フラグ。デフォルト: true */
        isDisplay?: boolean
        /** 投稿者名設定 */
        strName?: AXNOSPaintFormField
        /** タイトル設定 */
        strTitle?: AXNOSPaintFormField
        /** 本文設定 */
        strMessage?: AXNOSPaintFormField
        /** ウォッチリスト登録設定 */
        strWatchList?: {
            /** 項目表示フラグ。デフォルト: true */
            isDisplay?: boolean
        }
    }
    /** 注意事項設定 */
    notice?: {
        /** 項目表示フラグ。デフォルト: true */
        isDisplay?: boolean
    }
}

/** フォームフィールド設定 */
export type AXNOSPaintFormField = {
    /** 項目表示フラグ。デフォルト: true */
    isDisplay?: boolean
    /** 入力必須フラグ。デフォルト: false */
    isInputRequired?: boolean
    /** 入力可能な最大文字数。1～1024の範囲内。デフォルト: strName/strTitleは32、strMessageは1024 */
    maxLength?: number
    /** プレースホルダーとして表示する文字列。デフォルト: 空文字列 */
    placeholder?: string
}

/** 拡張タブ定義 */
export type AXNOSPaintExpansionTab = {
    /** タブに表示する名前 */
    name: string
    /** タブにポインタを重ねた時に左下に表示するガイドメッセージ */
    msg: string
} & (
    | {
          /** クリック時に別タブで開くURL（リンク表示モード） */
          link: string
          function?: never
      }
    | {
          /** クリック時に呼び出す関数（関数呼び出しモード） */
          function: () => void
          link?: never
      }
)
