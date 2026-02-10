export interface Model {
  value: string;
  label: string;
  description: string;
  inputTokens?: number;
  outputTokens?: number;
  uiStatus?: 'AVAILABLE' | 'EXHAUSTED';
}

export async function getViableModels(apiKey: string, apiBase: string = ''): Promise<Model[]> {
  try {
    // 1. Получаем список всех
    const listResp = await fetch(`${apiBase}/api/models-raw`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    if (!listResp.ok) return [];
    
    const listData = await listResp.json();
    if (!listData.models) return [];

    // 2. Фильтруем только те, что умеют генерить контент
    const candidates = listData.models.filter((m: any) => 
      m.supportedGenerationMethods && 
      m.supportedGenerationMethods.includes("generateContent")
    );

    // 3. Проверяем каждую (Probe)
    const results = await Promise.all(candidates.map(async (model: any) => {
      try {
        const modelValue = model.name.replace('models/', '');
        const resp = await fetch(`${apiBase}/api/probe-model`, {
           method: 'POST', 
           headers: {
             'Content-Type': 'application/json',
             'Authorization': `Bearer ${apiKey}`
           },
           body: JSON.stringify({ model: modelValue })
        });
        
        const data = await resp.json();

        if (resp.ok) {
          return {
            value: modelValue,
            label: model.displayName || modelValue,
            description: model.description || '',
            inputTokens: model.inputTokenLimit,
            outputTokens: model.outputTokenLimit,
            uiStatus: 'AVAILABLE' as const
          };
        }

        if (resp.status === 429) {
          const msg = data.error || "";
          // Если лимит 0 - значит модель вообще не включена в тариф
          if (msg.includes("limit: 0")) return null; 
          
          // Иначе лимит есть, но он кончился
          return {
            value: modelValue,
            label: model.displayName || modelValue,
            description: model.description || '',
            inputTokens: model.inputTokenLimit,
            outputTokens: model.outputTokenLimit,
            uiStatus: 'EXHAUSTED' as const
          };
        }

        // 400/403/404 - скорее всего недоступна
        return null;

      } catch (e) {
        return null;
      }
    }));

    const finalModels = results.filter((r): r is Model => r !== null);
    
    // Sort
    finalModels.sort((a, b) => {
      if (a.value.includes("2.5") && !b.value.includes("2.5")) return -1;
      if (!a.value.includes("2.5") && b.value.includes("2.5")) return 1;
      if (a.value.includes("2.0") && !b.value.includes("2.0")) return -1;
      if (!a.value.includes("2.0") && b.value.includes("2.0")) return 1;
      return a.label.localeCompare(b.label);
    });

    return finalModels;
  } catch (e) {
    console.error('getViableModels error:', e);
    return [];
  }
}
