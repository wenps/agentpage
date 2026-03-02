# Playwright DOM 交互实现研究报告

> 基于 playwright-main 源码分析，聚焦浏览器端注入脚本的 DOM 交互实现。

## 关键文件索引

| 文件 | 职责 |
|------|------|
| `packages/playwright-core/src/server/dom.ts` | **ElementHandle** — 服务端编排层，负责 actionability 检查、scroll、retry、hit-target 拦截，最终委托给 injected script 或 input 模块 |
| `packages/playwright-core/src/server/input.ts` | **Keyboard / Mouse / Touchscreen** — 通过 CDP/WebDriver BiDi 发出底层输入事件 |
| `packages/playwright-core/src/server/frames.ts` | **Frame** — selector 解析 → ElementHandle → 委托 dom.ts 动作 |
| `packages/playwright-core/src/server/types.ts` | 类型定义（SelectOption, PointerActionOptions 等） |
| `packages/injected/src/injectedScript.ts` | **InjectedScript** — 注入浏览器上下文的核心脚本，负责 DOM 状态检查、fill/selectOptions/selectText/focusNode/hit-target 等 |
| `packages/injected/src/domUtils.ts` | DOM 工具函数 — isElementVisible / parentElementOrShadowHost / enclosingShadowRootOrDocument 等 |

---

## 1. Click 实现

### 1.1 整体流程（dom.ts `ElementHandle._click` → `_retryPointerAction` → `_performPointerAction`）

```
Frame.click(selector)
  → _retryWithProgressIfNotConnected(selector, handle => handle._click())
    → ElementHandle._click()
      → _retryPointerAction('click', waitForEnabled=true, action=mouse.click)
        → _performPointerAction()
```

### 1.2 详细步骤（`_performPointerAction`，dom.ts L370-490）

1. **Actionability 等待**（除非 `force=true`）：
   ```typescript
   // 等待元素 visible + enabled + stable
   const elementStates: ElementState[] = waitForEnabled 
     ? ['visible', 'enabled', 'stable'] 
     : ['visible', 'stable'];
   await injected.checkElementStates(node, elementStates);
   ```

2. **滚动到视口**：
   - 首选协议原生滚动 `scrollRectIntoViewIfNeeded`
   - 如果被 sticky 元素遮挡，轮流尝试 4 种 `scrollIntoView` 对齐策略：
     ```typescript
     const scrollOptions = [
       undefined,  // 协议默认
       { block: 'end', inline: 'end' },
       { block: 'center', inline: 'center' },
       { block: 'start', inline: 'start' },
     ];
     // 每次重试使用不同对齐: scrollOptions[retry % 4]
     ```

3. **计算点击点**：
   - 如果指定了 `position`，使用 `_offsetPoint(position)` 基于 padding box
   - 否则使用 `_clickablePoint()` 基于 content quads 的中点
   - Firefox 特殊处理：寻找 quad 内的整数点避免舍入问题

4. **Hit-target 拦截设置**（除非 `force=true`）：
   - **帧级检查**：`_checkFrameIsHitTarget(point)` — 从内层 iframe 向上，每层检查 `elementFromPoint` 命中目标帧元素
   - **元素级拦截**：`injected.setupHitTargetInterceptor(node, 'mouse', hitPoint, trial)`
     - 预检 `expectHitTarget` 确认点击点命中目标元素
     - 注册 window 级 capture 监听器拦截 `mousedown/mouseup/pointerdown/pointerup/click/auxclick/dblclick/contextmenu`

5. **发出鼠标事件**：
   ```typescript
   // input.ts Mouse.click()
   await this.move(progress, x, y, { forClick: true });  // mousemove
   await this.down(progress, { button, clickCount: 1 });  // mousedown
   await this.up(progress, { button, clickCount: 1 });    // mouseup → 浏览器自动触发 click
   ```
   - 如果有 `delay`：down → wait(delay) → up，串行执行
   - 如果无 delay：move + down + up 并行 `Promise.all`

6. **Hit-target 验证**：
   - 每个拦截的事件检查 `expectHitTarget(clientX/Y, element)`
   - 如果目标不匹配，阻止事件传播（`preventDefault + stopImmediatePropagation`）

7. **Retry 机制**（dom.ts `_retryAction`）：
   - 等待时间递增：`[0, 20, 100, 100, 500]` ms
   - 可恢复错误自动重试：`error:notvisible`、`error:notinviewport`、`hitTargetDescription`、`missingState`
   - 不可恢复时抛出 `NonRecoverableDOMError`

### 1.3 Hit-target 检测详解（injectedScript.ts `expectHitTarget`）

```typescript
// 遍历 Shadow DOM 层级，从顶部到底部
// 每层使用 elementsFromPoint(x, y) 获取命中元素
// 检查命中元素是否是目标元素或其后代
// 通过 assignedSlot 和 parentElementOrShadowHost 遍历 composed tree
```

关键：支持 Shadow DOM、display:contents 修正、WebKit 元素顺序反转修正。

---

## 2. Fill 实现

### 2.1 流程

```
Frame.fill(selector, value)
  → ElementHandle._fill(value)
    → _retryAction('fill', ...)
      → actionability: checkElementStates(['visible', 'enabled', 'editable'])
      → injected.fill(node, value)
      → 根据返回值决定是否需要键盘输入
```

### 2.2 injectedScript.fill()（injectedScript.ts L824-858）

```typescript
fill(node: Node, value: string): 'error:notconnected' | 'needsinput' | 'done' {
  const element = this.retarget(node, 'follow-label');
  
  if (element is <input>) {
    // 区分两类 input 类型：
    const kInputTypesToSetValue = ['color', 'date', 'time', 'datetime-local', 'month', 'range', 'week'];
    const kInputTypesToTypeInto = ['', 'email', 'number', 'password', 'search', 'tel', 'text', 'url'];
    
    // 不支持的类型直接报错：
    // checkbox, radio, file, button, submit, reset, image, hidden 等
    
    if (kInputTypesToSetValue.has(type)) {
      // 直接设置 value（date/color/range 等原生控件）
      input.focus();
      input.value = value;
      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return 'done';
    }
    
    // text 类的 input → 返回 'needsinput'
  } else if (element is <textarea>) {
    // → 返回 'needsinput'
  } else if (element.isContentEditable) {
    // → 返回 'needsinput'
  } else {
    throw 'Element is not an <input>, <textarea> or [contenteditable] element';
  }
  
  // 对于需要键盘输入的情况：先选中现有文本
  this.selectText(element);
  return 'needsinput';
}
```

### 2.3 后续键盘输入（dom.ts L604-613）

```typescript
if (result === 'needsinput') {
  if (value)
    await this._page.keyboard.insertText(progress, value);  // 直接插入文本（非逐字符）
  else
    await this._page.keyboard.press(progress, 'Delete');     // 空值 → 删除选中内容
  return 'done';
}
```

### 2.4 selectText（injectedScript.ts L861-883）

```typescript
selectText(node: Node): 'error:notconnected' | 'done' {
  if (<input>)  → input.select() + input.focus()
  if (<textarea>) → selectionStart=0, selectionEnd=value.length, focus()
  else → createRange().selectNodeContents(element) + window.getSelection().addRange(range) + focus()
}
```

---

## 3. SelectOption 实现

### 3.1 流程

```
Frame.selectOption(selector, elements[], values[])
  → ElementHandle._selectOption()
    → _retryAction('select option', ...)
      → actionability: checkElementStates(['visible', 'enabled'])
      → injected.selectOptions(node, optionsToSelect)
```

### 3.2 injectedScript.selectOptions()（injectedScript.ts L777-820）

```typescript
selectOptions(node, optionsToSelect): string[] | error {
  const element = this.retarget(node, 'follow-label');
  // 必须是 <select> 元素
  if (element.nodeName !== 'select') throw 'Element is not a <select> element';
  
  const select = element as HTMLSelectElement;
  const options = [...select.options];
  
  for (const option of options) {
    // 匹配策略（支持多种方式）：
    // - 直接 Node 引用比较
    // - valueOrLabel: 匹配 option.value 或 option.label
    // - value: 精确匹配 option.value
    // - label: 精确匹配 option.label
    // - index: 精确匹配数组索引
    
    // 检查 option 是否 enabled
    if (!this.elementState(option, 'enabled').matches)
      return 'error:optionnotenabled';
    
    selectedOptions.push(option);
    
    // 非 multiple 模式下只选第一个匹配
    if (!select.multiple) break;
  }
  
  if (remainingOptionsToSelect.length)
    return 'error:optionsnotfound';
  
  // 执行选择
  select.value = undefined;  // 清除
  selectedOptions.forEach(option => option.selected = true);
  
  // 触发事件
  select.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
  
  return selectedOptions.map(option => option.value);
}
```

**关键点**：
- 仅支持原生 `<select>` 元素
- 支持 `value`、`label`、`index`、`valueOrLabel` 四种匹配策略
- 检查 option 是否 enabled
- 正确触发 `input` + `change` 事件

---

## 4. Type 实现（逐字符输入）

### 4.1 流程

```
Frame.type(selector, text)
  → ElementHandle._type(text)
    → focus(resetSelectionIfNotFocused=true)
    → page.keyboard.type(text, { delay })
```

### 4.2 Keyboard.type()（input.ts L102-112）

```typescript
async type(progress: Progress, text: string, options?: { delay?: number }) {
  const delay = options?.delay || undefined;
  for (const char of text) {
    if (usKeyboardLayout.has(char)) {
      // 可映射到键盘布局的字符 → press (keydown + keyup)
      await this.press(progress, char, { delay });
    } else {
      // Unicode 等特殊字符 → 直接 insertText
      if (delay) await progress.wait(delay);
      await this.insertText(progress, char);
    }
  }
}
```

**关键点**：
- **逐字符**处理
- 标准键盘字符通过 `keydown → keyup` 物理键盘事件
- 非标准字符（Unicode、emoji 等）通过 `insertText` CDP 命令
- 支持 `delay` 控制打字速度

---

## 5. Press 实现

### 5.1 流程

```
Frame.press(selector, key)
  → ElementHandle._press(key)
    → focus(resetSelectionIfNotFocused=true)
    → page.keyboard.press(key, { delay })
    → waitForSignalsCreatedBy (等待导航)
```

### 5.2 Keyboard.press()（input.ts L114-133）

```typescript
async press(progress: Progress, key: string, options: { delay?: number } = {}) {
  // 解析组合键，如 "Control+a" → ["Control", "a"]
  const tokens = split(key);  // 按 '+' 分割
  key = tokens[tokens.length - 1];
  
  // 按下所有修饰键
  for (let i = 0; i < tokens.length - 1; ++i)
    await this.down(progress, tokens[i]);
  
  // 按下主键
  await this.down(progress, key);
  if (options.delay) await progress.wait(options.delay);
  // 释放主键
  await this.up(progress, key);
  
  // 释放修饰键（逆序）
  for (let i = tokens.length - 2; i >= 0; --i)
    await this.up(progress, tokens[i]);
}
```

### 5.3 Keyboard.down/up（input.ts L63-91）

```typescript
async down(progress, key) {
  const description = this._keyDescriptionForString(key);
  const autoRepeat = this._pressedKeys.has(description.code);
  this._pressedKeys.add(description.code);
  // 追踪修饰键状态
  if (kModifiers.includes(description.key))
    this._pressedModifiers.add(description.key);
  await this._raw.keydown(progress, this._pressedModifiers, key, description, autoRepeat);
}
```

**关键点**：
- 支持组合键：`Control+Shift+a`
- 自动追踪修饰键状态（Alt, Control, Meta, Shift）
- `ControlOrMeta` 智能解析：macOS → Meta，其他 → Control
- 支持 autoRepeat 标记

---

## 6. Check/Uncheck 实现

### 6.1 流程（dom.ts `_setChecked`，L773-801）

```typescript
async _setChecked(progress, state: boolean, options) {
  // 1. 读取当前 checked 状态
  const checkedState = await isChecked();
  
  // 2. 如果已经是目标状态，直接返回
  if (checkedState.matches === state) return 'done';
  
  // 3. 不允许取消选中 radio button
  if (!state && checkedState.isRadio)
    throw 'Cannot uncheck radio button';
  
  // 4. 通过 click 切换状态
  const result = await this._click(progress, { ...options, waitAfter: 'disabled' });
  
  // 5. 验证状态确实改变了
  const finalState = await isChecked();
  if (finalState.matches !== state)
    throw 'Clicking the checkbox did not change its state';
  
  return 'done';
}
```

**关键点**：
- 通过 **click** 来切换，不是直接设置 checked 属性
- 先检查当前状态，已满足则跳过
- 点击后**验证状态变化**，确保操作生效
- 禁止取消选中 radio button

---

## 7. Hover 实现

### 7.1 流程（dom.ts L502-507）

```typescript
_hover(progress, options) {
  return this._retryPointerAction(
    progress, 
    'hover', 
    false,  // waitForEnabled = false（hover 不要求 enabled）
    point => this._page.mouse.move(progress, point.x, point.y),
    { ...options, waitAfter: 'disabled' }
  );
}
```

**关键点**：
- 复用 `_retryPointerAction` 完整流程（actionability + scroll + hit-target）
- actionability 只等待 `['visible', 'stable']`，不等待 `enabled`
- 实际操作是 `mouse.move()` 到目标点
- Hit-target 拦截只监听 `mousemove` 事件

---

## 8. Actionability 检查详解

### 8.1 checkElementStates（injectedScript.ts L640-658）

```typescript
async checkElementStates(node, states: ElementState[]) {
  // 'stable' 需要异步等待（多个 rAF 对比位置）
  if (states.includes('stable')) {
    const stableResult = await this._checkElementIsStable(node);
    // ...
  }
  // 其他状态同步检查
  for (const state of states) {
    if (state !== 'stable') {
      const result = this.elementState(node, state);
      if (!result.matches) return { missingState: state };
    }
  }
}
```

### 8.2 各状态检查方式（injectedScript.ts `elementState`，L717-775）

| 状态 | 实现 |
|------|------|
| **visible** | `isElementVisible(element)` → `computeBox()` 检查 display、visibility、rect 尺寸 > 0 |
| **hidden** | `!isElementVisible(element)` |
| **enabled** | `!getAriaDisabled(element)` — 基于 ARIA disabled 语义 |
| **disabled** | `getAriaDisabled(element)` |
| **editable** | `!disabled && !readonly` |
| **checked** | `getCheckedWithoutMixed(element)` — 仅 checkbox/radio |
| **unchecked** | `!checked` |
| **indeterminate** | `getCheckedAllowMixed(element) === 'mixed'` |

### 8.3 Stable 检查（injectedScript.ts `_checkElementIsStable`，L660-706）

```typescript
// 使用 requestAnimationFrame 循环比较元素位置
// 连续 stableRafCount 帧位置不变 → 稳定
// WebKit Win bug: 跳过 < 16ms 的帧

const check = () => {
  const rect = element.getBoundingClientRect();
  if (lastRect && samePosition) {
    if (++stableRafCounter >= this._stableRafCount)
      return true;  // 稳定！
  }
  lastRect = rect;
  return continuePolling;
};
```

### 8.4 isElementVisible（domUtils.ts L133）

```typescript
export function isElementVisible(element: Element): boolean {
  return computeBox(element).visible;
}

function computeBox(element: Element) {
  const style = getComputedStyle(element);
  
  // display:contents → 检查子元素是否可见
  if (style.display === 'contents') {
    for (child of element.children)
      if (isElementVisible(child)) return { visible: true };
    return { visible: false };
  }
  
  // visibility 检查（包含 checkVisibility() 现代 API）
  if (!isElementStyleVisibilityVisible(element, style))
    return { visible: false };
  
  // 尺寸检查
  const rect = element.getBoundingClientRect();
  return { visible: rect.width > 0 && rect.height > 0 };
}
```

### 8.5 retarget（injectedScript.ts L616-639）

元素重定向逻辑，根据行为模式处理标签关联：

```typescript
retarget(node, behavior: 'none' | 'follow-label' | 'no-follow-label' | 'button-link') {
  let element = node.nodeType === ELEMENT_NODE ? node : node.parentElement;
  
  if (behavior === 'none') return element;
  
  // 非 input/textarea/select/contenteditable → 查找最近的 button/link
  if (!element.matches('input, textarea, select') && !element.isContentEditable) {
    if (behavior === 'button-link')
      element = element.closest('button, [role=button], a, [role=link]') || element;
    else
      element = element.closest('button, [role=button], [role=checkbox], [role=radio]') || element;
  }
  
  // follow-label: 如果点击的是 <label>，跟随到关联的 control
  if (behavior === 'follow-label') {
    if (!element.matches('a, input, textarea, button, select, ...') && !element.isContentEditable) {
      const enclosingLabel = element.closest('label');
      if (enclosingLabel?.control)
        element = enclosingLabel.control;
    }
  }
  return element;
}
```

---

## 9. Scroll Into View

### 9.1 主要策略（dom.ts `_performPointerAction` L390-420）

```typescript
const doScrollIntoView = async () => {
  if (forceScrollOptions) {
    // 使用 element.scrollIntoView(options)
    return await this.evaluateInUtility(([injected, node, options]) => {
      (node as Element).scrollIntoView(options);
      return 'done';
    }, forceScrollOptions);
  }
  // 使用协议原生 scrollRectIntoViewIfNeeded
  return await this._scrollRectIntoViewIfNeeded(progress, position ? { x, y, w: 0, h: 0 } : undefined);
};
```

### 9.2 四种滚动对齐轮换（dom.ts L375-382）

```typescript
const scrollOptions = [
  undefined,                                    // 默认协议滚动
  { block: 'end', inline: 'end' },              // 右下对齐
  { block: 'center', inline: 'center' },        // 居中对齐
  { block: 'start', inline: 'start' },          // 左上对齐
];
const forceScrollOptions = scrollOptions[retry % scrollOptions.length];
```

目的：应对 sticky header/footer 遮挡目标元素的情况。

### 9.3 iframe 预滚动（dom.ts L408-413）

```typescript
if (this._frame.parentFrame()) {
  // Best-effort 滚动包含此元素的 iframe 到可见区域
  // 避免 iframe 被浏览器节流
  await doScrollIntoView().catch(() => {});
}
```

---

## 10. Event Types 分类

injectedScript 中定义的事件类型分类（用于 `dispatchEvent`）：

```typescript
// Mouse events
'auxclick', 'click', 'dblclick', 'mousedown', 'mouseenter', 'mouseleave',
'mousemove', 'mouseout', 'mouseover', 'mouseup', 'mousewheel'

// Keyboard events
'keydown', 'keyup', 'keypress', 'textInput'

// Touch events
'touchstart', 'touchmove', 'touchend', 'touchcancel'

// Pointer events
'pointerover', 'pointerout', 'pointerenter', 'pointerleave',
'pointerdown', 'pointerup', 'pointermove', 'pointercancel',
'gotpointercapture', 'lostpointercapture'

// Focus events: 'focus', 'blur'
// Drag events: 'drag', 'dragstart', 'dragend', 'dragover', 'dragenter', 'dragleave', 'dragexit', 'drop'
// Wheel: 'wheel'
```

### Hit-target 拦截事件分类

```typescript
hover:  ['mousemove']
tap:    ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'touchcancel']
mouse:  ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'click', 'auxclick', 'dblclick', 'contextmenu']
```

---

## 11. focusNode 实现（injectedScript.ts L897-921）

```typescript
focusNode(node, resetSelectionIfNotFocused?) {
  if (!node.isConnected) return 'error:notconnected';
  
  // Firefox contentEditable workaround:
  // blur 前一个活跃元素，否则 focus 不会切换
  if (node.isContentEditable && !wasFocused && activeElement?.blur)
    activeElement.blur();
  
  // Firefox 需要调用两次 focus()
  node.focus();
  node.focus();
  
  // 重置选区到开头（type 操作前）
  if (resetSelectionIfNotFocused && !wasFocused && node is <input>)
    input.setSelectionRange(0, 0);
}
```

---

## 12. 对 AutoPilot 的关键启示

### 12.1 我们的 dom-tool 应该对齐的核心模式

1. **Actionability 检查链**：visible → enabled → stable → scroll → hit-target → action
2. **Click 事件链**：Playwright 通过 CDP 发出 `mousemove → mousedown → mouseup`，浏览器自动生成 `click`。我们直接 `dispatchEvent` 时需要补齐完整事件链。
3. **Fill 二阶段模式**：
   - 特殊类型（date/color/range）→ 直接设 value + dispatch input/change
   - 文本类型 → `selectText()` + `insertText()`（不是逐字符 type）
4. **SelectOption**：直接操作 `<select>` DOM，设 `option.selected = true`，然后 dispatch `input` + `change`
5. **Check/Uncheck**：通过 **click** 实现，不直接设属性，且事后验证状态变化
6. **Hover**：就是 `mouse.move()` 到元素中心点
7. **Type vs Fill**：
   - `type` = 逐字符键盘事件，适合测试键盘交互
   - `fill` = 批量插入，更快更可靠

### 12.2 我们在浏览器内嵌环境的差异

- **我们没有 CDP/协议层**，所有操作必须在浏览器上下文直接执行
- 事件需要手动 `new Event()` / `new MouseEvent()` 等构造并 `dispatchEvent`
- `scrollIntoView` 可直接调用，无需协议滚动
- Hit-target 检查可简化（同源同帧，无跨进程问题）
- 我们的 `dom.click` 应该补齐 `pointerdown/mousedown/pointerup/mouseup/click` 事件链

### 12.3 可直接复用的 InjectedScript 函数

| 函数 | 可复用性 | 说明 |
|------|---------|------|
| `retarget()` | ✅ 直接复用 | label→control 映射 |
| `elementState()` | ✅ 直接复用 | 状态检查 |
| `isElementVisible()` | ✅ 直接复用 | 可见性检查 |
| `selectOptions()` | ✅ 参考实现 | select 操作 |
| `fill()` | ✅ 参考实现 | fill 二阶段分发 |
| `selectText()` | ✅ 直接复用 | 选中文本 |
| `focusNode()` | ✅ 参考实现 | 焦点管理 |
| `expectHitTarget()` | ⚠️ 可选复用 | 我们可能不需要全部 shadow DOM 处理 |
| `checkElementIsStable()` | ⚠️ 可选复用 | rAF 稳定性检测 |
