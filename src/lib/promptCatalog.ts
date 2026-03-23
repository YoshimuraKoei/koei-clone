export type PromptTheme =
  | 'emotion'
  | 'work'
  | 'relationship'
  | 'rest'
  | 'habit'
  | 'choice'
  | 'anxiety'
  | 'value';

export type PromptTimeframe = 'today' | 'recent' | 'this_week' | 'right_now' | 'tomorrow';
export type PromptFocus = 'event' | 'thought' | 'feeling' | 'action' | 'body' | 'relationship';
export type PromptCognitiveAction =
  | 'label'
  | 'reflect'
  | 'compare'
  | 'prioritize'
  | 'release'
  | 'concretize'
  | 'reframe';
export type PromptDepth = 'light' | 'medium' | 'deep';
export type PromptTone = 'gentle' | 'direct' | 'calm' | 'playful';
export type PromptFormat = 'question' | 'journal_prompt' | 'prompt_stub' | 'metaphor' | 'haiku_like';
export type PromptConcreteness = 'abstract' | 'semi_concrete' | 'concrete';
export type PromptActionability = 'reflect' | 'next_step';
type DaySlot = 'morning' | 'evening';

export type PromptSelection = {
  theme: PromptTheme;
  timeframe: PromptTimeframe;
  focus: PromptFocus;
  cognitiveAction: PromptCognitiveAction;
  depth: PromptDepth;
  tone: PromptTone;
  format: PromptFormat;
  concreteness: PromptConcreteness;
  actionability: PromptActionability;
  slot: DaySlot;
};

const THEMES: PromptTheme[] = ['emotion', 'work', 'relationship', 'rest', 'habit', 'choice', 'anxiety', 'value'];
const FOCUSES: PromptFocus[] = ['event', 'thought', 'feeling', 'action', 'body', 'relationship'];
const COGNITIVE_ACTIONS: PromptCognitiveAction[] = [
  'label',
  'reflect',
  'compare',
  'prioritize',
  'release',
  'concretize',
  'reframe',
];
const DEPTHS: PromptDepth[] = ['light', 'medium', 'deep'];
const TONES: PromptTone[] = ['gentle', 'direct', 'calm', 'playful'];
const CONCRETENESS_LEVELS: PromptConcreteness[] = ['abstract', 'semi_concrete', 'concrete'];
const FORMATS_BY_SLOT: Record<DaySlot, PromptFormat[]> = {
  morning: ['question', 'journal_prompt', 'prompt_stub', 'metaphor'],
  evening: ['question', 'journal_prompt', 'prompt_stub', 'metaphor', 'haiku_like'],
};
const ACTIONABILITY_BY_SLOT: Record<DaySlot, PromptActionability[]> = {
  morning: ['next_step', 'reflect'],
  evening: ['reflect', 'next_step'],
};

function daySlot(now: Date): DaySlot {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    hour12: false,
  }).format(now);
  return Number.parseInt(hour, 10) < 12 ? 'morning' : 'evening';
}

function sample<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function sampleWithBias<T>(items: T[], preferred: T[]): T {
  const source = preferred.length && Math.random() < 0.7 ? preferred : items;
  return sample(source);
}

function adjustTimeframe(slot: DaySlot, actionability: PromptActionability): PromptTimeframe[] {
  if (actionability === 'next_step') {
    return slot === 'morning' ? ['today', 'tomorrow'] : ['tomorrow', 'recent'];
  }
  return slot === 'morning' ? ['today', 'this_week', 'recent'] : ['today', 'recent', 'right_now'];
}

function allowedFormats(selection: Omit<PromptSelection, 'format'>): PromptFormat[] {
  return FORMATS_BY_SLOT[selection.slot].filter((format) => {
    if (format === 'haiku_like' && selection.depth === 'deep') {
      return false;
    }
    if (format === 'haiku_like' && selection.actionability === 'next_step') {
      return false;
    }
    if (format === 'metaphor' && selection.concreteness === 'concrete' && selection.actionability === 'next_step') {
      return false;
    }
    return true;
  });
}

function allowedTones(selection: Omit<PromptSelection, 'tone' | 'format'>): PromptTone[] {
  return TONES.filter((tone) => {
    if (selection.theme === 'anxiety' && tone === 'playful') {
      return false;
    }
    if (selection.theme === 'rest' && tone === 'direct' && selection.depth === 'deep') {
      return false;
    }
    return true;
  });
}

export function selectPrompt(now: Date): PromptSelection {
  const slot = daySlot(now);
  const actionability = sampleWithBias(
    ACTIONABILITY_BY_SLOT[slot],
    slot === 'morning'
      ? (['next_step'] as PromptActionability[])
      : (['reflect'] as PromptActionability[])
  );
  const theme = sample(THEMES);
  const timeframe = sample(adjustTimeframe(slot, actionability));
  const focus = sample(FOCUSES);
  const cognitiveAction = sample(COGNITIVE_ACTIONS);
  const depth = sampleWithBias(
    DEPTHS,
    slot === 'morning'
      ? (['light', 'medium'] as PromptDepth[])
      : (['medium', 'deep'] as PromptDepth[])
  );
  const concreteness = sampleWithBias(
    CONCRETENESS_LEVELS,
    actionability === 'next_step'
      ? (['concrete', 'semi_concrete'] as PromptConcreteness[])
      : (['semi_concrete', 'abstract'] as PromptConcreteness[])
  );

  const partialSelection = {
    theme,
    timeframe,
    focus,
    cognitiveAction,
    depth,
    concreteness,
    actionability,
    slot,
  };
  const tone = sample(allowedTones(partialSelection));
  const format = sample(allowedFormats({ ...partialSelection, tone }));

  return {
    ...partialSelection,
    tone,
    format,
  };
}

function toneHint(tone: PromptTone): string {
  switch (tone) {
    case 'gentle':
      return '優しく、押しつけがましくしない。';
    case 'direct':
      return '率直で、少し芯のある言い方にする。';
    case 'calm':
      return '静かで落ち着いた言い方にする。';
    case 'playful':
      return '少し遊び心を混ぜるが、雑にふざけない。';
  }
}

function formatHint(format: PromptFormat): string {
  switch (format) {
    case 'question':
      return '自然な質問文 1 文で返す。';
    case 'journal_prompt':
      return '短い日記の書き出しのような 1〜2 文で返す。';
    case 'prompt_stub':
      return '書き出し文や補助線として 1〜2 文で返す。';
    case 'metaphor':
      return '比喩を少し混ぜた問いにするが、意味不明にしない。';
    case 'haiku_like':
      return '俳句風の短さや余白を少し使うが、読みやすい日本語にする。';
  }
}

function actionabilityHint(actionability: PromptActionability): string {
  return actionability === 'next_step'
    ? '最後は小さな次の一歩や具体化につながる問いにする。'
    : '内省に集中し、無理に行動へ結びつけない。';
}

export function buildPromptInstruction(selection: PromptSelection): string {
  return [
    'あなたはユーザーの内省を促すコーチです。',
    '今日の問いを 1 つだけ、日本語で返してください。',
    '生成のたびに発想を変え、似た問いへ収束しないでください。',
    '次のような凡庸な問いは避けてください: 「今日、あなたにとって最も大切なことはなんですか」, 「本当にやりたいことは何ですか」, 「今の気持ちは？」',
    '多少変わった切り口でもよいが、意味が通らない文や答えにくすぎる文にはしないでください。',
    'フォーマットは必ず「今日の問い：<内容>」とする。',
    `時間帯: ${selection.slot === 'morning' ? '朝' : '夜'}`,
    `テーマ: ${selection.theme}`,
    `時間軸: ${selection.timeframe}`,
    `対象: ${selection.focus}`,
    `認知操作: ${selection.cognitiveAction}`,
    `深さ: ${selection.depth}`,
    `具体性: ${selection.concreteness}`,
    toneHint(selection.tone),
    formatHint(selection.format),
    actionabilityHint(selection.actionability),
  ].join('\n');
}
