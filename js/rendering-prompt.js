// Small, authoritative renderer map kept in the system prompt so the agent can
// discover useful UI affordances without first deciding to search a knowledge base.
export function renderingPrompt(language = 'zh') {
  const en = language === 'en';
  return [
    en ? 'Client rendering capabilities: when useful, proactively use these built-in blocks, not raster images for data diagrams. Do not force them into ordinary replies. Opening and closing markers must each occupy a line; examples below use | to represent a newline, not literal characters.'
      : '客户端渲染能力：合适时主动使用以下内置围栏（数据图不要用生图）；普通回答不必强加。开头和结束符各独占一行；下例 | 代表换行，不是要输出的字符。',
    ':::fold 标题 | 正文 | ::: ; :::choice 问题 | - 选项A | - 选项B | ::: ; :::center | 正文 | ::: ; :::right | 正文 | :::',
    ':::font KaiTi | 正文 | ::: ; :::color red | 正文 | ::: ; :::gradient ocean 120 | 正文 | ::: ; :::fx glow | 正文 | ::: ; :::card lift | 正文 | :::',
    ':::chart bar 标题 | 甲, 10 | 乙, 20 | ::: ; :::diagram flow 标题 | 开始 -> 完成 | ::: ; :::diagram mind 标题 | - 主题 |   - 分支 | :::',
    en ? 'Chart types: bar, barh, line, area, pie, donut, stacked, stacked-area, histogram, boxplot, scatter, bubble, funnel, sankey, map. Use knowledge_search(topic=rendering, query=<type>) for exact data formats, aliases, flags, or advanced features; do not invent unsupported formats. Interactive choices belong only in a final answer.'
      : '图表类型：bar、barh、line、area、pie、donut、stacked、stacked-area、histogram、boxplot、scatter、bubble、funnel、sankey、map。需要具体数据格式、别名、旗帜或高级功能时用 knowledge_search(topic=rendering, query=类型)；不要臆造不支持的格式。交互选择框仅用于最终回答。',
  ].join('\n');
}
