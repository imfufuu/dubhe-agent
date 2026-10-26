# Local moderation lexicons

These lists are bundled as **candidate vocabulary only**. A match is not, by itself, a reason to block an ordinary message. The local policy combines terminology with intent, action, quotation, reporting, education, prevention, and other context. The broad profanity lists are used only by the strict local salutation check; political, religious, historical, scientific, news, victim-report, and help-seeking contexts are not treated as raw keyword violations.

## Sources

- **LDNOOBW — List of Dirty, Naughty, Obscene and Otherwise Bad Words**: original per-language files from commit `5faf2ba42d7b1c0977169ec3611df25a3c08eb13`; 28 language/locale files. Source: <https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words>. Licensed CC BY 4.0; see `ldnobw/LICENSE`. The generated local index normalizes and groups terms for lookup.
- **4troDev/profanity.csv**: original per-language CSV files from commit `402f12c87cc4b06cbdd9577824a4a4cb8af6b38b`; 12 languages. Source: <https://github.com/4troDev/profanity.csv>. Licensed MIT; see `4tro/LICENSE`. The generated local index normalizes and groups terms for lookup.
- **Konsheng/Sensitive-lexicon**: only `Vocabulary/涉枪涉爆.txt` from commit `d967c30b053fa40b06c5a0dddf0be493f2dfae46` is included. Source: <https://github.com/konsheng/Sensitive-lexicon>. Licensed MIT; see `konsheng/LICENSE`. The political, religious, and other unrelated categories are deliberately not included.

The source lists are community-maintained lexical resources, not exhaustive dictionaries, multilingual classifiers, or statements about the meaning of any word in every context. The application uses a small contextual subset for deterministic review and does not send moderation text to these repositories or to a remote moderation endpoint as part of this local check.
