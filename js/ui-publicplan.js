import { publicPlanMarkdown } from './publicplan.js';
import { renderMarkdown } from './ui-markdown.js?v=2026.10.11.1';
export function publicPlanHtml(plan) { return plan?.direction ? `<section class="public-task-plan">${renderMarkdown(publicPlanMarkdown(plan))}</section>` : ''; }
