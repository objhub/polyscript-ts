<script lang="ts">
  import type { Profile } from '@polyscript/core';
  import { CUSTOM_PRESET } from './profile-helpers.js';

  interface ParamInfo {
    name: string;
    type: 'int' | 'float' | 'string' | 'bool';
    default: any;
    min?: number;
    max?: number;
    step?: number;
    label?: string;
    desc?: string;
    choices?: any[];
    group: string;
    hidden: boolean;
  }

  interface Props {
    params: ParamInfo[];
    overrides: Record<string, unknown>;
    onchange: (name: string, value: unknown) => void;
    onreset: () => void;
    profile?: Profile;
    selectedPreset?: string;
    onpresetchange?: (presetName: string) => void;
  }

  let { params, overrides, onchange, onreset, profile, selectedPreset, onpresetchange }: Props = $props();

  const visibleParams = $derived(params.filter(p => !p.hidden));

  const groups = $derived(() => {
    const map = new Map<string, ParamInfo[]>();
    for (const p of visibleParams) {
      const g = p.group || 'General';
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(p);
    }
    return map;
  });

  function currentValue(p: ParamInfo): any {
    return p.name in overrides ? overrides[p.name] : p.default;
  }

  function hasOverrides(): boolean {
    return Object.keys(overrides).length > 0;
  }

  function handleNumberInput(p: ParamInfo, e: Event) {
    const target = e.target as HTMLInputElement;
    const v = p.type === 'int' ? parseInt(target.value, 10) : parseFloat(target.value);
    if (!isNaN(v)) onchange(p.name, v);
  }

  function handleSelectChange(p: ParamInfo, e: Event) {
    const target = e.target as HTMLSelectElement;
    const raw = target.value;
    if (p.type === 'int') onchange(p.name, parseInt(raw, 10));
    else if (p.type === 'float') onchange(p.name, parseFloat(raw));
    else onchange(p.name, raw);
  }

  function handlePresetSelect(e: Event) {
    const target = e.target as HTMLSelectElement;
    const value = target.value;
    if (value !== CUSTOM_PRESET && onpresetchange) {
      onpresetchange(value);
    }
  }

  function stepFor(p: ParamInfo): number {
    if (p.step !== undefined) return p.step;
    return p.type === 'int' ? 1 : 0.1;
  }

  const hasProfile = $derived(profile != null && profile.entries.length > 0);
  const presetSelectValue = $derived(selectedPreset ?? CUSTOM_PRESET);
</script>

{#if visibleParams.length === 0 && !hasProfile}
  <div class="params-pane empty">
    <p class="placeholder">No parameters defined.</p>
    <p class="hint">Add <code>@param</code> annotations to your code to expose parameters here.</p>
  </div>
{:else}
  <div class="params-pane">
    <div class="params-scroll">
      {#if hasProfile}
        <div class="preset-section">
          <span class="preset-label">Preset</span>
          <select
            class="preset-select"
            value={presetSelectValue}
            onchange={handlePresetSelect}
          >
            {#each profile!.entries as entry}
              <option value={entry.name}>{entry.name}</option>
            {/each}
            <option value={CUSTOM_PRESET}>Custom</option>
          </select>
        </div>
      {/if}

      {#each [...groups().entries()] as [groupName, groupParams]}
        {#if groups().size > 1}
          <div class="group-header">{groupName}</div>
        {/if}
        {#each groupParams as p}
          <div class="param-row">
            <span class="param-label">
              {p.label || p.name}
              {#if p.desc}
                <span class="desc-icon" title={p.desc}>?</span>
              {/if}
            </span>
            <div class="param-control">
              {#if p.choices && p.choices.length > 0}
                <!-- Dropdown -->
                <select
                  value={String(currentValue(p))}
                  onchange={(e) => handleSelectChange(p, e)}
                >
                  {#each p.choices as choice}
                    <option value={String(choice)}>{choice}</option>
                  {/each}
                </select>
              {:else if p.type === 'bool'}
                <!-- Toggle -->
                <label class="toggle">
                  <input
                    type="checkbox"
                    checked={!!currentValue(p)}
                    onchange={(e) => onchange(p.name, (e.target as HTMLInputElement).checked)}
                  />
                  <span class="toggle-label">{currentValue(p) ? 'ON' : 'OFF'}</span>
                </label>
              {:else if (p.type === 'int' || p.type === 'float') && p.min !== undefined && p.max !== undefined}
                <!-- Slider -->
                <div class="slider-group">
                  <input
                    type="range"
                    min={p.min}
                    max={p.max}
                    step={stepFor(p)}
                    value={currentValue(p)}
                    oninput={(e) => handleNumberInput(p, e)}
                  />
                  <span class="slider-value">{currentValue(p)}</span>
                </div>
              {:else if p.type === 'int' || p.type === 'float'}
                <!-- Number input -->
                <input
                  type="number"
                  step={stepFor(p)}
                  min={p.min}
                  max={p.max}
                  value={currentValue(p)}
                  onchange={(e) => handleNumberInput(p, e)}
                />
              {:else}
                <!-- Text input -->
                <input
                  type="text"
                  value={currentValue(p) ?? ''}
                  onchange={(e) => onchange(p.name, (e.target as HTMLInputElement).value)}
                />
              {/if}
            </div>
          </div>
        {/each}
      {/each}
    </div>
    {#if hasOverrides()}
      <div class="reset-bar">
        <button class="reset-btn" onclick={onreset}>Reset to defaults</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .params-pane {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #fff;
  }
  .params-pane.empty {
    align-items: center;
    justify-content: center;
    padding: 2rem;
    color: #a0aec0;
  }
  .placeholder {
    font-size: 14px;
    font-weight: 500;
  }
  .hint {
    font-size: 12px;
    margin-top: 0.5rem;
  }
  .hint code {
    font-family: 'JetBrains Mono', monospace;
    background: #f1f5f9;
    padding: 1px 4px;
    border-radius: 3px;
    color: #4a5568;
  }

  .params-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
  }

  /* Preset dropdown section */
  .preset-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid #e2e8f0;
  }
  .preset-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #718096;
  }
  .preset-select {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid #cbd5e0;
    border-radius: 4px;
    font-size: 13px;
    font-family: 'JetBrains Mono', monospace;
    background: #f7fafc;
    box-sizing: border-box;
    cursor: pointer;
  }
  .preset-select:focus {
    outline: none;
    border-color: #4ecdc4;
    box-shadow: 0 0 0 2px rgba(78, 205, 196, 0.2);
  }

  .group-header {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #718096;
    padding: 8px 0 4px;
    border-bottom: 1px solid #e2e8f0;
    margin-bottom: 8px;
  }
  .group-header:not(:first-child) {
    margin-top: 12px;
  }

  .param-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
  }

  .param-label {
    font-size: 12px;
    font-weight: 500;
    color: #4a5568;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .desc-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #e2e8f0;
    color: #718096;
    font-size: 10px;
    font-weight: 600;
    cursor: help;
    flex-shrink: 0;
  }
  .desc-icon:hover {
    background: #cbd5e0;
    color: #4a5568;
  }

  .param-control {
    width: 100%;
  }

  .param-control input[type="number"],
  .param-control input[type="text"],
  .param-control select {
    width: 100%;
    padding: 4px 8px;
    border: 1px solid #e2e8f0;
    border-radius: 4px;
    font-size: 13px;
    font-family: 'JetBrains Mono', monospace;
    background: #f7fafc;
    box-sizing: border-box;
  }
  .param-control input:focus,
  .param-control select:focus {
    outline: none;
    border-color: #4ecdc4;
    box-shadow: 0 0 0 2px rgba(78, 205, 196, 0.2);
  }

  .slider-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .slider-group input[type="range"] {
    flex: 1;
    height: 4px;
    accent-color: #4ecdc4;
    cursor: pointer;
  }
  .slider-value {
    font-size: 12px;
    font-family: 'JetBrains Mono', monospace;
    color: #4a5568;
    min-width: 40px;
    text-align: right;
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }
  .toggle input[type="checkbox"] {
    accent-color: #4ecdc4;
    width: 16px;
    height: 16px;
    cursor: pointer;
  }
  .toggle-label {
    font-size: 12px;
    font-family: 'JetBrains Mono', monospace;
    color: #718096;
  }

  .reset-bar {
    flex-shrink: 0;
    padding: 8px 12px;
    border-top: 1px solid #e2e8f0;
    background: #f7fafc;
  }
  .reset-btn {
    width: 100%;
    padding: 6px;
    border: 1px solid #e2e8f0;
    border-radius: 4px;
    background: #fff;
    font-size: 12px;
    color: #718096;
    cursor: pointer;
  }
  .reset-btn:hover {
    background: #edf2f7;
    color: #4a5568;
  }
</style>
