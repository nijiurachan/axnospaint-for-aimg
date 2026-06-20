// @description キーボード入力処理

export class KeyboardSystem {
    axpObj;
    constructor(axpObj) {
        this.axpObj = axpObj;
    }
    // 初期化
    init() {
    }
    startEvent() {
        const readModKeyConfig = () => {
            const get = (id, def) => {
                const el = document.getElementById(id);
                return el ? el.value : def;
            };
            return {
                ' ':       get('axp_config_select_modkey_space', 'hand'),
                'SHIFT':   get('axp_config_select_modkey_shift', 'line'),
                'CONTROL': get('axp_config_select_modkey_ctrl',  'spuit'),
                'ALT':     get('axp_config_select_modkey_alt',   'eraser'),
            };
        };
        this.modKeyActions = readModKeyConfig();

        for (const id of ['axp_config_select_modkey_space', 'axp_config_select_modkey_shift',
                           'axp_config_select_modkey_ctrl', 'axp_config_select_modkey_alt']) {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', () => { this.modKeyActions = readModKeyConfig(); });
        }

        this.activeModifiers = {};

        const applyAction = (action, down) => {
            switch (action) {
                case 'hand':
                    if (down) this.axpObj.penSystem.changePenModeTemporary('axp_penmode_hand');
                    else this.axpObj.penSystem.restorePenModeTemporary('axp_penmode_hand');
                    break;
                case 'eraser':
                    if (down) this.axpObj.penSystem.changePenModeTemporary('axp_penmode_eraser');
                    else this.axpObj.penSystem.restorePenModeTemporary('axp_penmode_eraser');
                    break;
                case 'spuit':
                    if (down) this.axpObj.penSystem.changePenModeTemporary('axp_penmode_spuit');
                    else this.axpObj.penSystem.restorePenModeTemporary('axp_penmode_spuit');
                    break;
                case 'line':
                    this.axpObj.isLineMod = down;
                    if (down && this.axpObj.isDrawing) this.axpObj.isLine = true;
                    break;
            }
        };

        window.addEventListener('blur', () => {
            for (const [, action] of Object.entries(this.activeModifiers)) {
                applyAction(action, false);
            }
            this.activeModifiers = {};
            this.axpObj.isSPACE = false;
            this.axpObj.isCTRL = false;
            this.axpObj.isLineMod = false;
            this.axpObj.isALT = false;
            if (this.axpObj.codeCHANGE_SIZE_KEY) {
                this.axpObj.codeCHANGE_SIZE_KEY = null;
            }
        });

        window.addEventListener('keyup', (e) => {
            if (!e.key) return;
            const inkey = e.key.toUpperCase();
            if (this.activeModifiers[inkey]) {
                const releasedAction = this.activeModifiers[inkey];
                delete this.activeModifiers[inkey];
                const stillHeld = Object.values(this.activeModifiers).includes(releasedAction);
                if (!stillHeld) applyAction(releasedAction, false);
            }
            switch (inkey) {
                case ' ': this.axpObj.isSPACE = false; break;
                case 'CONTROL': this.axpObj.isCTRL = false; break;
                case 'SHIFT': this.axpObj.isLineMod = false; break;
                case 'ALT': this.axpObj.isALT = false; break;
            }
            if (e.code === this.axpObj.codeCHANGE_SIZE_KEY) {
                this.axpObj.penSystem.modeChangeSizeOff();
            }
        });

        window.addEventListener('keydown', (e) => {
            if (this.axpObj.isClose || !this.axpObj.isCanvasOpen || this.axpObj.isModalOpen) return;
            const tag = document.activeElement.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            e.preventDefault();

            const inkey = e.key.toUpperCase();

            if (this.axpObj.isDrawing) {
                const action = this.modKeyActions[inkey];
                if (action === 'line') this.axpObj.isLine = true;
                return;
            }

            if (e.repeat && (inkey === ' ' || inkey === 'CONTROL' || inkey === 'ALT' || inkey === 'SHIFT')) return;

            const action = this.modKeyActions[inkey];
            if (action && action !== 'none') {
                switch (inkey) {
                    case ' ': this.axpObj.isSPACE = true; break;
                    case 'CONTROL': this.axpObj.isCTRL = true; break;
                    case 'SHIFT': this.axpObj.isLineMod = true; break;
                    case 'ALT': this.axpObj.isALT = true; break;
                }
                this.activeModifiers[inkey] = action;
                applyAction(action, true);
            } else if (!action) {
                let keyId = inkey;
                switch (keyId) {
                    case '*': keyId = 'ASTERISK'; break;
                    case '+': keyId = 'PLUS'; break;
                    case ',': keyId = 'COMMA'; break;
                    case '-': keyId = 'MINUS'; break;
                    case '.': keyId = 'DOT'; break;
                    case '/': keyId = 'SLASH'; break;
                    case ':': keyId = 'COLON'; break;
                    case ';': keyId = 'SEMICOLON'; break;
                }
                console.log('keyboard:', e.code, e.key, '->', inkey, keyId);
                this.axpObj.callTask(`axp_config_custom_key${keyId}`, inkey, e.repeat, e.code);
            }
        });
    }
}
