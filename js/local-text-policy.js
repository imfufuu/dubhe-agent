// Local, language-aware policy rules. This is a conservative lexical layer, not a substitute for contextual review.
export const BLOCKING_TEXT = new Set([
  'minor_sexual', 'adult_sexual', 'drug_crime', 'gun_crime', 'crime_facilitation',
  'mass_harm', 'credible_threat', 'public_morals', 'exploitative_sexual', 'self_harm',
  'hate', 'political_violence', 'religious_extremism', 'severe_profanity', 'cyber_crime',
]);

const list = (value) => value.split('|').map((item) => item.trim()).filter(Boolean);
const ZERO_WIDTH = /[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu;
const MARKS = /\p{M}+/gu;
const NON_LATIN = /[^\p{Script=Latin}\p{N}\s]/u;
const ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;
const termCache = new Map();

function normalizeRaw(value) {
  let text = String(value ?? '');
  try { text = text.normalize('NFKD'); } catch { /* old runtimes */ }
  return text.toLowerCase().replace(MARKS, '').replace(ZERO_WIDTH, '')
    .replace(/[0０]/gu, 'o').replace(/[1１!！|]/gu, 'i').replace(/[3３]/gu, 'e')
    .replace(/[4４@]/gu, 'a').replace(/[5５$]/gu, 's');
}
function normalizeWords(value) {
  return normalizeRaw(value).replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/gu, ' ').trim();
}
function compactWords(value) { return value.replace(/\s+/gu, ''); }
function escapeRegExp(value) { return value.replace(ESCAPE_RE, '\\$&'); }

function infoForTerm(rawTerm) {
  const key = String(rawTerm);
  if (termCache.has(key)) return termCache.get(key);
  const words = normalizeWords(key);
  const compact = compactWords(words);
  const nonLatin = NON_LATIN.test(words);
  const phrase = words.split(' ').map(escapeRegExp).join('\\s+');
  const exactPattern = nonLatin || !phrase ? null : new RegExp(`(?:^|\\s)(${phrase})(?=$|\\s)`, 'u');
  const suffixPattern = nonLatin || !phrase ? null : new RegExp(`(?:^|\\s)(${phrase})(?:[\\p{L}]{1,8})(?=$|\\s)`, 'u');
  const info = { words, compact, nonLatin, exactPattern, suffixPattern };
  termCache.set(key, info);
  return info;
}

function makeInput(value) {
  const raw = normalizeRaw(value);
  const words = raw.replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  return { raw, words, compact: compactWords(words) };
}

function hasTerm(input, rawTerm, { suffix = true } = {}) {
  const term = infoForTerm(rawTerm);
  if (!term.compact) return false;
  if (term.nonLatin) return input.compact.includes(term.compact);
  if (term.exactPattern?.test(input.words)) return true;
  return Boolean(suffix && term.suffixPattern?.test(input.words));
}
function hasAny(input, terms, options) { return terms.some((term) => hasTerm(input, term, options)); }
function startsWithAny(input, terms) {
  return terms.some((rawTerm) => {
    const term = infoForTerm(rawTerm);
    if (!term.compact) return false;
    if (term.nonLatin) return input.compact.startsWith(term.compact);
    const phrase = term.words.split(' ').map(escapeRegExp).join('\\s+');
    return Boolean(phrase && new RegExp(`^${phrase}(?:[\\p{L}]{0,8})(?=$|\\s)`, 'u').test(input.words));
  });
}
function hasObfuscatedAny(input, terms) {
  return terms.some((rawTerm) => {
    const term = infoForTerm(rawTerm);
    if (term.nonLatin || term.compact.length < 4) return false;
    if (!term.obfuscatedPattern) {
      const letters = [...term.compact].map(escapeRegExp).join('[^\\p{L}\\p{N}]{0,2}');
      term.obfuscatedPattern = new RegExp(`(?:^|[^\\p{L}\\p{N}])${letters}(?=$|[^\\p{L}\\p{N}])`, 'u');
    }
    return term.obfuscatedPattern.test(input.raw);
  });
}

function compactPositions(input, term) {
  const out = [];
  let at = input.compact.indexOf(term.compact);
  while (at >= 0) {
    out.push(at);
    at = input.compact.indexOf(term.compact, at + 1);
  }
  return out;
}
function compactToWordIndex(words, index) {
  let seen = 0;
  for (let i = 0; i < words.length; i++) {
    if (words[i] === ' ') continue;
    if (seen === index) return i;
    seen++;
  }
  return words.length;
}
function termPositions(input, rawTerm) {
  const term = infoForTerm(rawTerm);
  if (!term.compact || !hasTerm(input, rawTerm)) return [];
  if (term.nonLatin) return compactPositions(input, term).map((at) => compactToWordIndex(input.words, at));
  const phrase = term.words.split(' ').map(escapeRegExp).join('\\s+');
  const pattern = new RegExp(`(?:^|\\s)(${phrase})(?:[\\p{L}]{0,8})?(?=$|\\s)`, 'gu');
  const out = [];
  let match;
  while ((match = pattern.exec(input.words))) out.push(match.index + match[0].indexOf(match[1]));
  return out;
}
function nearby(input, leftTerms, rightTerms, window = 56) {
  for (const left of leftTerms) {
    const positions = termPositions(input, left);
    if (!positions.length) continue;
    const leftLen = infoForTerm(left).words.length;
    for (const position of positions) {
      const start = Math.max(0, position - window);
      const end = Math.min(input.words.length, position + leftLen + window);
      const span = makeInput(input.words.slice(start, end));
      if (hasAny(span, rightTerms)) return true;
    }
  }
  return false;
}

const SAFE_CONTEXT = list(`科普|教育|医学|醫學|健康|治疗|治療|心理咨询|预防|預防|识别|識別|举报|舉報|受害者|保护|保護|历史|歷史|新闻|新聞|报道|報導|研究|学术|學術|法律|课堂|課程|课程|社会学|犯罪学|戒毒|康复|復健|翻译|翻譯|词义|詞義|语言学|紀錄片|纪录片|教育|学術|歴史|報道|予防|相談|治療|保護|翻訳|解説|educational|education|academic|history|historical|news report|reporting|research|prevention|treatment|therapy|safety|legal|law|awareness|translation|definition|linguistic|documentary|recovery|public health|educación|educacion|académico|academico|historia|noticias|prevención|prevencion|tratamiento|terapia|jurídico|juridico|traducción|traduccion|éducation|education|universitaire|histoire|actualité|actualite|prévention|prevention|traitement|thérapie|therapie|juridique|traduction|bildung|geschichte|nachrichten|prävention|pravention|behandlung|recht|übersetzung|ubersetzung|educação|educacao|história|historia|notícias|noticias|prevenção|prevencao|tratamento|tradução|traducao|교육|역사|뉴스|예방|치료|법률|번역|연구|образование|история|новости|профилактика|лечение|закон|перевод|исследование|تعليم|تاريخ|أخبار|اخبار|وقاية|علاج|قانون|ترجمة|بحث`);
const EDUCATION_PRODUCT_CONTEXT = list(`课程|課程|课程材料|課程教材|教材|教学材料|教學材料|讲义|講義|课堂|課堂|培训材料|培訓材料|安全教育课程|防范课程|course|curriculum|lesson plan|teaching material|classroom material|training module|awareness course|curso|material didáctico|material didactico|plan de clase|cours|programme de formation|plan de leçon|plan de lecon|unterrichtsmaterial|lehrplan|schulungsmaterial|curso de formação|material didático|수업 자료|교육 과정|교재|учебный курс|учебные материалы|учебная программа|منهج تعليمي|مواد تعليمية|دورة توعوية`);
const PREVENTION_CONTEXT = list(`预防|預防|防止|预防犯罪|預防犯罪|危害降低|减害|康复|戒毒|自杀预防|自殺予防|自残预防|教育|prevent|prevention|harm reduction|recovery|rehabilitation|avoid|protect|safety plan|crisis support|prevención|prevencion|reducir daños|reducción de daños|prévention|reduction des risques|schadensminderung|prävention|prevencion|prevenção|prevencao|redução de danos|예방|피해 예방|자살 예방|위험 감소|профилактика|снижение вреда|предотвратить|وقاية|الوقاية|تقليل الضرر`);
const SUPPORT_CONTEXT = list(`求助|需要帮助|需要協助|如何帮助|如何協助|帮助朋友|陪伴|心理咨询|心理諮詢|危机热线|危機專線|自杀预防|自殺預防|自残预防|支持热线|相談先|相談窓口|自殺予防|支援|悩み相談|need help|looking for help|need support|support a friend|help a friend|mental health support|crisis line|crisis hotline|suicide prevention|self-harm prevention|counselor|counselling|counseling|therapy|recovery support|necesito ayuda|busco ayuda|apoyar a un amigo|ayuda psicológica|ayuda psicologica|línea de crisis|linea de crisis|prévention du suicide|besoin d'aide|soutenir un ami|ligne d'aide|psychologische hilfe|hilfe suchen|suizidprävention|hilfe für einen freund|기분이 힘들|도움이 필요|친구를 돕|자살 예방|상담|помощь|нужна помощь|поддержка|помочь другу|линия помощи|مساعدة|أحتاج مساعدة|دعم نفسي|خط المساعدة|الوقاية من الانتحار`);
const QUOTE_OR_TRANSLATION = list(`翻译|翻譯|词义|詞義|定义|定義|语言学|引用|原文|translation|translate|definition|linguistic|quoted|quotation|meaning of|traducción|traduccion|significado|traduction|définition|definition|übersetzung|übersetzen|bedeutung|übersetzung|tradução|traducao|번역|뜻|Перевод|значение|ترجمة|معنى`);
const CREATIVE_INTENT = list(`写|撰写|生成|创作|描写|描述|续写|扮演|小说|故事|片段|台词|写出|编写|制作|write|draft|generate|create|compose|describe|depict|roleplay|role play|novel|story|scene|script|make|produce|draw|write me|escribe|redacta|crear|generar|describir|relato|historia|écris|rédige|créer|générer|décrire|récit|schreibe|erstellen|generieren|beschreiben|geschichte|skript|escreva|criar|gerar|descrever|história|historia|작성|쓰다|생성|창작|묘사|소설|이야기|написать|создать|сгенерировать|описать|рассказ|история|اكتب|أنشئ|انشئ|إنشاء|إنشاء قصة|وصف`);
const REQUEST_CUES = list(`怎么|如何|教我|告诉我|告訴我|给我步骤|給我步驟|一步一步|步骤|步驟|方法|配方|计划|計劃|教程|指南|绕过|逃避警察|躲避警方|藏匿证据|藏匿證據|どうやって|教えて|教えろ|手順|作り方|how to|tell me how|teach me|show me how|how do i|how do you|how can i|how would i|step by step|instructions|recipe|method|plan|guide me|avoid police|evade police|hide evidence|get away with|cómo|como|enséñame|ensename|paso a paso|instrucciones|receta|método|metodo|plan|éviter la police|eviter la police|comment|étapes|etapes|anleitung|schritt für schritt|wie kann ich|polizei umgehen|beweise verstecken|como fazer|passo a passo|instruções|instrucoes|방법을 알려|어떻게|단계별|지침|방법|как|научи меня|расскажи как|как сделать|пошагово|инструкция|способ|как обойти полицию|скрыть улики|كيف|علمني|أخبرني|اخبرني|كيف أصنع|كيف اصنع|خطوة بخطوة|طريقة|تعليمات|كيف أتجنب الشرطة|كيف اتجنب الشرطة`);
const DIRECT_HARM_INTENT = list(`号召|鼓动|鼓動|煽动|煽動|组织袭击|組織襲擊|策划袭击|策劃襲擊|计划杀|計劃殺|準備殺|准备杀|应该杀|應該殺|必须杀|必須殺|杀光|殺光|灭绝所有|滅絕所有|消灭所有|消滅所有|刺杀所有|刺殺所有|暗杀领导人|暗殺領導人|炸毁政府|炸毀政府|袭击政府|襲擊政府|袭击官员|襲擊官員|枪杀官员|槍殺官員|屠杀所有|屠殺所有|去死吧|殺せ|皆殺し|殺すべき|襲撃しろ|爆破しろ|call for violence|call to kill|call to attack|urge violence|kill all|killing all|kill them|kill immigrants|kill refugees|kill muslims|kill jews|kill the president|should kill|let's kill|let us kill|we should kill|we must kill|exterminate all|wipe out all|murder them|attack now|attack parliament|attack the government|bomb parliament|bomb the government|shoot officials|assassinate the president|rape them|burn them|should die|merecen morir|hay que matar|matar a todos|deberían matar|deberian matar|exterminar a todos|aniquilar a todos|tuer tout|il faut tuer|devrait tuer|exterminer tous|ausrotten alle|alle töten|töten soll|убить всех|уничтожить всех|убить их|надо убить|اقتل الجميع|اقتلهم|إبادة|ابادة|يجب قتل|모두 죽여|죽여야 한다|죽여야해|皆殺しにしろ|殺すべき`);
const DIRECT_GENERATION_INTENT = list(`写|写出|写一段|撰写|生成|创作|编写|写口号|制作口号|发布|发表|write|draft|generate|create|compose|produce|publish|post|write a slogan|make a slogan|escribe|redacta|crea|genera|écris|rédige|créer|générer|schreibe|erstelle|generiere|verfasse|작성해|만들어|напиши|создай|напишите|اكتب|أنشئ|انشئ`);

const MINOR_TERMS = list(`未成年|未成年人|儿童|兒童|孩子|小孩|幼女|幼童|小学生|小學生|初中生|高中生|萝莉|蘿莉|正太|未成年者|子ども|子供|児童|幼児|未成年|미성년자|아동|어린이|청소년|niño|niña|menor de edad|menores|infantil|enfant|mineur|mineure|adolescent|kind|minderjährig|minderjaehrig|jugendlich|ребенок|ребёнок|дети|несовершеннолетний|подросток|طفل|أطفال|اطفال|قاصر|قاصرون|child|children|minor|underage|teenager|teen`);
const SEXUAL_TERMS = list(`色情|情色|性爱|性交|做爱|性行为|裸体|裸照|裸聊|淫秽|黄片|成人小说|成人视频|口交|肛交|露骨|淫乱|性侵|强奸|恋童|porn|pornography|pornographic|erotic|sexually explicit|sexual content|nude|naked|nsfw|intercourse|oral sex|anal sex|explicit sex|child porn|child pornography|sexually exploit|incest|bestiality|necrophilia|zoophilia|revenge porn|nonconsensual|non-consensual|rape|sexual assault|わいせつ|ポルノ|性的|性行為|裸|児童ポルノ|強姦|性的虐待|음란|포르노|성행위|나체|아동 포르노|강간|pornografía|pornografia|erótico|erotico|desnudo|desnuda|sexo explícito|sexo explicito|pornographie|érotique|erotique|nudité|nudite|sexuel explicite|porno|nackt|pornografisch|erotisch|sexuell explizit|nacktheit|pornografia|erótico|erotico|nudez|sexo explícito|pornografia|эротика|порнография|обнаженный|обнажённый|сексуальное насилие|إباحية|جنس صريح|عري|اغتصاب|اعتداء جنسي`);
const EXPLICIT_PORN_TERMS = list(`色情|情色|黄片|成人视频|色情小说|淫秽|淫亂|porn|pornography|pornographic|smut|xxx|explicit porn|revenge porn|child porn|child pornography|ポルノ|児童ポルノ|음란물|포르노|pornografía|pornografia|pornographie|porno|pornografisch|порнография|إباحية`);
const FAMILY_TERMS = list(`父女|母子|母女|父子|兄妹|姐弟|兄弟|姐妹|亲兄妹|親兄妹|亲姐弟|親姐弟|继父|繼父|继母|繼母|爸爸|妈妈|父亲|母亲|女儿|儿子|父と娘|母と息子|兄妹|近親|가족|父女|母子|padre e hija|madre e hijo|hermanos|incest|father daughter|mother son|siblings|inceste|père et fille|mere et fils|geschwister|vater und tochter|madre e figlia|pai e filha|мать и сын|отец и дочь|أب وابنته|أم وابنها`);
const TABOO_TERMS = list(`乱伦|亂倫|近亲相奸|近親相姦|家庭乱伦|家庭亂倫|incest|familial sexual|bestiality|zoophilia|necrophilia|coprophilia|兽交|獸交|人兽|人獸|恋尸|戀屍|奸尸|姦屍|尸体性行为|屍體性交|粪便性行为|排泄物性癖|近親性交|近親相姦|근친상간|수간|수간물|zoofilia|necrofilia|coprofilia|bestialité|zoophilie|nécrophilie|bestialitat|zoophilie|nekrophilie|содомия|зоофилия|некрофилия|جماع المحارم|سفاح المحارم`);
const EXPLOIT_TERMS = list(`偷拍|非自愿|非自願|强迫|強迫|胁迫|脅迫|迷奸|下药|下藥|性侵|强奸|強姦|裸照|报复性色情|revenge porn|nonconsensual|non-consensual|forced sex|rape|sexual assault|voyeurism|偷拍|強制性交|性暴力|강제 성관계|불법 촬영|성폭력|violación|violacion|no consentido|sin consentimiento|viol|non consenti|agression sexuelle|vergewaltigung|nicht einvernehmlich|sexuelle Gewalt|estupro|sem consentimento|estupro|consentimento|насилие|изнасилование|без согласия|اغتصاب|دون موافقة|إكراه جنسي`);

const DRUG_TERMS = list(`冰毒|甲基苯丙胺|海洛因|可卡因|芬太尼|摇头丸|搖頭丸|K粉|氯胺酮|致幻剂|致幻劑|非法毒品|毒品|methamphetamine|meth|heroin|cocaine|fentanyl|mdma|ecstasy|ketamine|lsd|hard drugs|illegal drugs|narcotics|覚醒剤|覚醒剤|メタンフェタミン|ヘロイン|コカイン|フェンタニル|ケタミン|違法薬物|마약|메스암페타민|필로폰|헤로인|코카인|펜타닐|불법 약물|metanfetamina|heroína|heroina|cocaína|cocaina|fentanilo|drogas ilegales|drogas duras|méthamphétamine|methamphetamine|héroïne|heroine|cocaïne|cocaine|fentanyl|drogues illégales|methamphetamin|heroin|kokain|fentanyl|illegale drogen|metanfetamina|heroína|cocaína|fentanilo|drogas ilegais|метамфетамин|героин|кокаин|фентанил|наркотики|нелегальные наркотики|ميثامفيتامين|هيروين|كوكايين|فنتانيل|مخدرات غير قانونية`);
const DRUG_ACTIONS = list(`制造|製造|制作|製作|合成|提炼|提煉|种植|種植|配方|制毒|製毒|贩卖|販賣|贩毒|販毒|走私|分销|分銷|出售|卖给|賣給|购买|購買|买|買|订购|訂購|藏匿|运输|運輸|制造毒品|制造药物|make|manufacture|synthesize|produce|cook|refine|grow|extract|recipe for|sell|deal|traffic drugs|smuggle|distribute|buy|purchase|obtain|order|source|acquire|hide|ship|製造|合成|精製|栽培|密売|密輸|販売|売る|買う|購入|注文|만들|제조|합성|정제|재배|밀매|밀수|판매|구매|구입|fabricar|producir|sintetizar|refinar|cultivar|vender|traficar|traficar drogas|contrabandear|distribuir|comprar|adquirir|conseguir|pedir|fabriquer|produire|synthétiser|raffiner|cultiver|vendre|acheter|commander|obtenir|trafiquer|trafic de drogues|contrebande|herstellen|produzieren|synthetisieren|raffinieren|anbauen|verkaufen|kaufen|bestellen|beschaffen|schmuggeln|vertreiben|fabricar|produzir|sintetizar|refinar|cultivar|vender|traficar|contrabandear|comprar|adquirir|conseguir|изготовить|производить|синтезировать|очищать|выращивать|продавать|сбывать|купить|заказать|достать|приобрести|перевозить|прятать|تصنيع|يصنع|إنتاج|تركيب|تكرير|زراعة|بيع|تهريب|توزيع|شراء|اشتر|طلب|الحصول على|إخفاء`);
const DRUG_HARD_ACTIONS = list(`制造|製造|制作|製作|合成|提炼|提煉|种植|種植|配方|制毒|製毒|make|manufacture|synthesize|produce|cook|refine|grow|extract|recipe|製造|合成|精製|栽培|제조|합성|정제|재배|fabricar|sintetizar|producir|fabriquer|synthétiser|herstellen|synthetisieren|изготовить|синтезировать|تصنيع|إنتاج|تركيب|تكرير`);

const WEAPON_TERMS = list(`枪|槍|手枪|手槍|步枪|步槍|枪支|槍枝|子弹|子彈|弹药|彈藥|火器|霰弹枪|霰彈槍|炸弹|炸彈|爆炸物|枪械|槍械|gun|firearm|pistol|rifle|shotgun|ammunition|ammo|bullet|silencer|bomb|explosive|銃|拳銃|ライフル|弾薬|銃弾|爆弾|爆発物|총기|권총|소총|탄약|총알|폭탄|폭발물|arma de fuego|pistola|rifle|escopeta|munición|municion|bala|bomba|explosivo|arme à feu|arme a feu|pistolet|fusil|munitions|bombe|explosif|schusswaffe|pistole|gewehr|munition|bombe|sprengstoff|arma de fogo|pistola|espingarda|munição|municao|bomba|explosivo|огнестрельное оружие|оружие|ружье|ружьё|пистолет|винтовка|боеприпасы|патрон|бомба|взрывчатка|سلاح ناري|بندقية|مسدس|ذخيرة|قنبلة|متفجرات`);
const WEAPON_ACTIONS = list(`制造|制造枪|自制|制作|製作|组装|組裝|制作炸弹|製作炸彈|装配|裝配|改造|绕过检测|繞過檢測|走私|非法购买|非法購買|攻击|襲擊|袭击|枪击|槍擊|射杀|射殺|引爆|制造爆炸|make|build|assemble|modify|convert|craft|manufacture|buy illegally|smuggle|evade detection|shoot|attack|detonate|build a bomb|製造|製作|作る|組み立て|組み立てる|改造|密輸|銃撃|爆破|攻撃|총기 제작|개조|조립|밀수|총격|공격|fabricar|construir|montar|modificar|comprar ilegalmente|traficar|disparar|atacar|detonar|fabriquer|construire|assembler|modifier|acheter illégalement|contrebande|tirer|attaquer|detoner|herstellen|bauen|zusammenbauen|umbauen|illegal kaufen|schmuggeln|schießen|angreifen|detonieren|fabricar|construir|montar|modificar|comprar ilegalmente|disparar|atacar|detonar|изготовить|собрать|переделать|купить нелегально|контрабанда|стрелять|атаковать|взорвать|صنع|تصنيع|تجميع|تعديل|تهريب|شراء غير قانوني|إطلاق النار|هجوم|تفجير`);
const WEAPON_HARD_ACTIONS = list(`制造|自制|制作|製作|组装|組裝|制作炸弹|製作炸彈|装配|裝配|绕过检测|繞過檢測|走私|非法购买|非法購買|make|build|assemble|modify|convert|craft|manufacture|buy illegally|smuggle|build a bomb|製造|製作|作る|組み立て|組み立てる|改造|密輸|총기 제작|개조|조립|밀수|fabricar|construir|montar|modificar|comprar ilegalmente|traficar|fabriquer|construire|assembler|modifier|acheter illégalement|contrebande|herstellen|bauen|zusammenbauen|umbauen|illegal kaufen|schmuggeln|изготовить|собрать|переделать|купить нелегально|контрабанда|صنع|تصنيع|تجميع|تعديل|تهريب|شراء غير قانوني`);

const CRIME_TERMS = list(`诈骗|詐騙|诈骗案|欺诈|欺詐|盗窃|盜竊|抢劫|搶劫|入室盗窃|入室盜竊|勒索|敲诈|敲詐|绑架|綁架|人口贩卖|人口販賣|洗钱|洗錢|伪造证件|偽造證件|假身份证|假身分證|藏匿证据|藏匿證據|逃避警察|逃避警方|身份盗窃|身份盜竊|信用卡盗刷|贿赂|賄賂|贩卖人口|犯罪|fraud|scam|phishing|theft|robbery|burglary|extortion|blackmail|kidnapping|human trafficking|money laundering|forgery|fake id|identity theft|credit card fraud|bribery|stolen credentials|詐欺|窃盗|強盗|恐喝|誘拐|人身売買|資金洗浄|偽造|証拠隠滅|사기|절도|강도|협박|납치|인신매매|자금세탁|위조|증거 인멸|estafa|fraude|phishing|robo|robar|asalto|extorsión|extorsion|chantaje|secuestro|trata de personas|blanqueo de dinero|falsificación|falsificacion|usurpación de identidad|usurpacion de identidad|escroquerie|fraude|vol|voler|braquage|extorsion|chantage|enlèvement|enlevement|traite des êtres humains|blanchiment d'argent|faux papiers|usurpation d'identité|betrug|diebstahl|raub|erpressung|entführung|entfuhrung|menschenhandel|geldwäsche|geldwasche|fälschung|falschung|identitätsdiebstahl|identitatsdiebstahl|fraude|roubo|extorsão|extorsao|sequestro|tráfico humano|trafico humano|lavagem de dinheiro|falsificação|falsificacao|мошенничество|кража|грабеж|вымогательство|похищение|торговля людьми|отмывание денег|подделка|подделать документы|احتيال|سرقة|سطو|ابتزاز|اختطاف|اتجار بالبشر|غسل الأموال|تزوير|تزوير وثائق`);
const CRIME_ACTIONS = list(`骗取|骗走|偷钱|偷走|盗用|偷取|抢钱|搶錢|伪造|偽造|销毁证据|銷毀證據|隐藏证据|隱藏證據|逃避警方|做假证|做假證|steal|rob|scam|defraud|phish|forge|counterfeit|blackmail|extort|kidnap|launder|break into|hide evidence|destroy evidence|evade police|avoid cops|fake documents|fake id|forge id|steal identity|rob|詐欺する|詐欺|盗|窃盗|強盗する|偽造する|恐喝する|誘拐する|隠す|証拠隠滅|警察を避け|警察から逃げ|훔치|강탈|사기 치|피싱|위조|협박|납치|세탁|증거 숨기|경찰 피하|estafar|robar|saquear|falsificar|extorsionar|secuestrar|lavar dinero|ocultar pruebas|evadir a la policía|evadir a la policia|escroquer|voler|braquer|falsifier|extorquer|enlever|blanchir de l'argent|cacher des preuves|polizei umgehen|beweise verstecken|fälschen|faelschen|stehlen|rauben|betrügen|betruegen|erpressen|entführen|entfuehren|geld waschen|roubar|assaltar|falsificar|extorquir|sequestrar|lavar dinheiro|ocultar provas|обмануть|украсть|ограбить|подделать|вымогать|похитить|скрыть улики|обойти полицию|سرقة|احتيال|تزوير|ابتزاز|إخفاء الأدلة|تجنب الشرطة`);
const CRIME_OBJECTS = list(`钱|錢|账户|帳戶|银行卡|銀行卡|身份证|身分證|证件|證件|密码|密碼|账号|帳號|银行|銀行|文件|证据|證據|钱财|錢財|钱款|金钱|偷来的钱|偷來的錢|money|bank|account|identity|documents|credit card|password|credentials|evidence|someone|somebody|person|victim|customer|passport|id card|car|vehicle|home|house|store|shop|company|business|client|employee|wallet|jewelry|jewellery|laptop|package|goods|property|data|お金|金を|証拠|書類|계좌|돈|문서|증거|dinero|banco|cuenta|identidad|documentos|dinero|banque|compte|identité|identite|documents|geld|bank|konto|identität|identitat|dokumente|dinheiro|banco|conta|documentos|деньги|банк|счет|счёт|документы|المال|حساب|هوية|وثائق|شخص|ضحية`);
const CRIME_DIRECT_INTENT = list(`i will steal|i will scam|i will rob|i want to steal|i want to scam|i want to rob|we will steal|we plan to rob|let's rob|let us rob|let's steal|我要偷|我想偷|计划诈骗|計劃詐騙|打算抢劫|打算搶劫|我要诈骗|我想诈骗|voy a robar|quiero robar|quiero estafar|je vais voler|je veux voler|ich werde stehlen|ich will betrügen|ich will betruegen|돈을 훔칠|사기를 치겠|я хочу украсть|я буду грабить|أريد أن أسرق|سأسرق`);
const CRIME_OPERATION_TERMS = list(`commit fraud|commit a crime|commit theft|commit robbery|carry out fraud|carry out a crime|how to commit|plan a robbery|get away with fraud|get away with theft|cover up a crime|conceal a crime|fake an id|forge an id|hide evidence|destroy evidence|dispose of evidence|steal money|steal an identity|forge documents|fake a passport|launder money|commit fraud|cometer fraude|cometer un delito|cometer un crime|commettre une fraude|commettre un crime|betrug begehen|eine straftat begehen|犯罪を実行|犯罪を隠す|사기 치는 방법|범죄를 저지르|совершить мошенничество|совершить преступление|как совершить кражу|ارتكاب جريمة|ارتكاب احتيال`);
const CRIME_EVASION_TERMS = list(`avoid police|evade police|avoid cops|escape police|hide from police|evade law enforcement|escape law enforcement|hide evidence|destroy evidence|dispose of evidence|hide stolen goods|逃避警方|逃避警察|躲避警方|躲避警察|藏匿证据|藏匿證據|销毁证据|銷毀證據|証拠を隠す|証拠隠滅|警察を避け|警察から逃げ|경찰 피하|증거 숨기|evadir a la policía|evadir a la policia|evitar a la policía|evitar a la policia|ocultar pruebas|destruir pruebas|éviter la police|eviter la police|cacher les preuves|détruire les preuves|detruire les preuves|polizei umgehen|beweise verstecken|beweise vernichten|roubar evidências|roubar evidencias|ocultar provas|скрыть улики|обойти полицию|избежать полиции|إخفاء الأدلة|تجنب الشرطة`);
const CYBER_TERMS = list(`恶意软件|惡意軟體|勒索软件|勒索軟體|木马|木馬|病毒|钓鱼攻击|釣魚攻擊|盗号|盜號|盗取凭据|盜取憑據|漏洞利用|恶意代码|惡意程式|malware|ransomware|spyware|keylogger|phishing kit|credential theft|stolen credentials|exploit payload|botnet|trojan|remote access trojan|zero day exploit|computer system|server|network|router|wifi|wi-fi|website|password|credentials|account|paywall|access control|authentication|マルウェア|ランサムウェア|フィッシング|ウイルス|トロイの木馬|認証情報窃取|脆弱性悪用|악성코드|랜섬웨어|피싱|바이러스|트로이목마|계정 탈취|malware|ransomware|suplantación de identidad|suplantacion de identidad|robo de credenciales|troyano|virus|rançongiciel|rancongiciel|logiciel malveillant|hameçonnage|vol d'identifiants|cheval de troie|schadsoftware|ransomware|spähsoftware|spaehsoftware|passwortdiebstahl|trojaner|malware|ransomware|phishing|roubo de credenciais|cavalo de troia|вредоносное по|шифровальщик|кража учетных данных|кража учётных данных|троян|فيروس|برمجيات خبيثة|برمجية فدية|تصيد احتيالي|سرقة بيانات الاعتماد|حصان طروادة`);
const CYBER_ACTIONS = list(`编写|制作|创建|部署|传播|植入|窃取|盜取|盗取|入侵|绕过|绕过认证|利用漏洞|攻击服务器|write|create|build|develop|deploy|launch|spread|steal|exfiltrate|hack|break into|bypass|exploit|weaponize|infect|evade detection|phish|steal credentials|dump credentials|write malware|deploy ransomware|作成|作る|展開|拡散|侵入|盗む|認証を回避|악성코드 작성|배포|유포|계정 탈취|해킹|crear|escribir|desplegar|propagar|robar credenciales|explotar|infectar|piratear|créer|écrire|déployer|propager|voler des identifiants|exploiter|infizieren|bereitstellen|verbreiten|passwörter stehlen|hacken|criar|escrever|implantar|propagar|roubar credenciais|explorar|создать|написать|развернуть|распространить|украсть данные|взломать|إنشاء|كتابة|نشر|توزيع|سرقة بيانات|اختراق|استغلال`);

const CRIME_VICTIM_CONTEXT = list(`我被骗|我被騙|被诈骗|被詐騙|被偷|被抢劫|被搶劫|受害者|报案|報案|报警|報警|报告诈骗|報告詐騙|police harassment|police brutality|police misconduct|report police abuse|report a scam|report fraud|report a crime|report to police|victim of fraud|i was scammed|i got scammed|i was robbed|i got robbed|was defrauded|denunciar|me estafaron|fui estafado|fui víctima|fui victima|déposer plainte|deposer plainte|victime d'une escroquerie|ich wurde betrogen|betrugsopfer|ich bin bestohlen|사기를 당했|피해 신고|신고하다|меня обманули|я стал жертвой|заявить в полицию|تعرضت للاحتيال|أبلغ عن احتيال|ابلغ عن احتيال|الإبلاغ عن جريمة`);

const SELF_HARM_TERMS = list(`自杀|自殺|轻生|輕生|自尽|自盡|结束生命|結束生命|自残|自殘|自我伤害|自我傷害|割腕|自伤|自傷|伤害自己|傷害自己|肢体自残|肢體自殘|寻死|尋死|kill myself|kill yourself|suicide|suicidal|self harm|self-harm|self injury|self-injury|self mutilation|self-mutilation|mutilate myself|cut myself|end my life|take my own life|overdose myself|se suicider|suicidio|suicidarme|quitarme la vida|autolesión|autolesion|cortarme|me tuer|se suicider|suicide|automutilation|me suicider|m'automutiler|selbstmord|suizid|mich umbringen|selbstverletzung|sich schneiden|자살|자해|목숨을 끊|손목을 긋|самоубийство|покончить с собой|самоповреждение|порезать себя|انتحار|أقتل نفسي|اقتل نفسي|إيذاء النفس|اذية النفس|أجرح نفسي|اجرحي نفسي`);
const SELF_HARM_METHODS = list(`如何自杀|怎麼自殺|怎么自杀|自杀方法|自殺方法|无痛自杀|無痛自殺|有效自杀方法|有效自殺方法|最简单的自杀|最簡單的自殺|教我自杀|教我自殺|自杀教程|自殺教程|自杀步骤|自殺步驟|自杀的方式|自残方法|自残的方式|自残的手段|自傷方法|自傷の方法|自分を傷つける方法|自殺の方法|自殺する方法|自殺する手段|自傷する方法|suicide method|suicide methods|method of suicide|methods of suicide|self-harm method|self harm method|how to mutilate myself|how to disfigure myself|how to kill myself|how can i kill myself|how to commit suicide|tell me how to commit suicide|suicide instructions|instructions to kill myself|painless suicide|least painful suicide|best way to die|step by step suicide|cómo suicidarme|como suicidarme|método de suicidio|metodo de suicidio|suicidarme sin dolor|comment me suicider|comment se suicider|méthode de suicide|methode de suicide|suicide sans douleur|wie bringe ich mich um|suizidmethode|suizid methode|wie kann ich mich umbringen|자살 방법|자살하는 방법|자해 방법|방법을 알려줘|как покончить с собой|способ самоубийства|безболезненный способ самоубийства|как умереть без боли|كيف أقتل نفسي|كيف اقتل نفسي|طريقة الانتحار|طريقة قتل نفسي|انتحار بدون ألم|انتحار بدون الم`);
const SELF_HARM_ENCOURAGEMENT = list(`鼓励自杀|鼓勵自殺|怂恿自杀|慫恿自殺|你应该自杀|你應該自殺|去自杀|去自殺|去死吧|让他自杀|讓他自殺|encourage suicide|go kill yourself|you should kill yourself|you deserve to die|go die|tell them to die|suicide is good|suicide is heroic|anima a suicidarse|deberías suicidarte|deberias suicidarte|tu devrais te suicider|va te tuer|du solltest dich umbringen|bring dich um|죽어|자살해|자살하라고|убей себя|покончи с собой|иди умри|اقتل نفسك|انتحر|اذهب ومت`);

const THREAT_PATTERNS = list(`我会杀了你|我會殺了你|我要杀了你|我要殺了你|我会杀他|我会杀她|我會殺他|我會殺她|我要杀他|我要杀她|我杀了你|我殺了你|杀你全家|殺你全家|弄死你|我要伤害你|我要傷害你|威胁杀害你|威脅殺害你|我会伤害他|我会伤害她|我會傷害他|我會傷害她|i will kill you|i'll kill you|i ll kill you|im going to kill you|i am going to kill you|i will kill him|i will kill her|i will kill them|i will kill my boss|i will shoot you|i will shoot him|i will shoot her|i will shoot them|i will hurt you|i will hurt him|i will hurt her|i will hurt them|i will hurt your family|i will bomb your house|you are dead|you're dead|i know where you live|i am coming for you|i'm coming for you|i will find you|i'll find you|death threat|threat to kill you|threaten to kill you|te voy a matar|voy a matarte|te mataré|te matare|te voy a disparar|sé dónde vives|se donde vives|je vais te tuer|je vais te tirer dessus|je te tuerai|je sais où tu habites|je sais ou tu habites|ich werde dich töten|ich bringe dich um|ich werde dich erschießen|ich werde dich erschiessen|ich weiß wo du wohnst|ich weiss wo du wohnst|총으로 쏴 죽일|널 죽일 거야|널 죽일거야|죽여버릴 거야|죽여버릴거야|죽이겠다|殺してやる|殺すぞ|お前を殺す|お前を撃つ|я убью тебя|я тебя убью|я тебя застрелю|я знаю где ты живешь|я знаю где ты живёшь|سأقتلك|سوف أقتلك|سوف اقتلك|سأطلق النار عليك|سأؤذيك|تهديد بالقتل`);

const THREAT_REPORT_CONTEXT = list(`someone threatened me|someone threatened my family|i was threatened|i received a death threat|received a death threat|my boss threatened me|my boss threatened to kill|my friend threatened me|threatened to kill me|report a death threat|report this threat|threat from my|victim of a threat|me amenazaron|recibí una amenaza|recibi una amenaza|on m'a menacé|on ma menace|j'ai reçu une menace|ich wurde bedroht|ich habe eine drohung erhalten|위협을 받았|협박을 당했|мне угрожали|получил угрозу|تعرضت للتهديد|تلقيت تهديدا|تلقيت تهديدًا`);

const HATE_TARGETS = list(`移民|难民|難民|外国人|外國人|少数民族|少數民族|某民族|种族|種族|犹太人|猶太人|穆斯林|基督徒|佛教徒|印度教徒|黑人|白人|亚洲人|亞洲人|同性恋者|同性戀者|跨性别者|跨性別者|残疾人|身心障碍者|女性|妇女|婦女|男性|难民|台湾人|香港人|维吾尔族|藏族|immigrant|immigrants|refugee|refugees|jews|jewish people|muslims|muslim people|members of another faith|members of another religion|followers of another faith|christians|hindus|buddhists|black people|asian people|gay people|trans people|transgender people|disabled people|women|men|roma|immigrés|immigres|réfugiés|refugies|juifs|musulmans|chrétiens|chretiens|hindous|bouddhistes|personnes noires|personnes handicapées|personnes handicapees|personnes trans|inmigrantes|inmigrantes|refugiados|judíos|judios|musulmanes|cristianos|hindúes|hindues|personas negras|personas trans|personas con discapacidad|einwanderer|flüchtlinge|fluchtlinge|juden|muslime|christen|hindus|buddhisten|schwarze menschen|behinderte|transpersonen|mulheres|imigrantes|refugiados|judeus|muçulmanos|muculmanos|cristãos|cristaos|hindus|negros|pessoas trans|장애인|이민자|난민|유대인|무슬림|기독교인|흑인|성소수자|트랜스젠더|женщины|мужчины|мигранты|беженцы|евреи|мусульмане|христиане|чернокожие|инвалиды|трансгендеры|مهاجرون|لاجئون|يهود|مسلمون|مسيحيون|نساء|رجال|ذوو الإعاقة`);
const HATE_ACTIONS = list(`杀光|殺光|杀死|殺死|灭绝|滅絕|消灭|消滅|屠杀|屠殺|去死|低等|贱种|賤種|害虫|害蟲|畜生|不配活|应该被杀|應該被殺|驱逐|驅逐|杀光所有|kill|murder|exterminate|wipe out|eradicate|lynch|enslave|burn|inferior|subhuman|vermin|parasites|should die|deserve death|no right to live|deport all|tuer|exterminer|anéantir|aneantir|inférieur|inferieur|vermine|sous-humain|matar|exterminar|aniquilar|inferiores|plaga|merecen morir|töten|ausrotten|vernichten|Ungeziefer|minderwertig|matar|exterminar|aniquilar|inferiores|мерзавцы|убить|истребить|уничтожить|недочеловеки|вредители|اقتل|أبيد|ابيد|إبادة|ابادة|يستحقون الموت|حشرات`);
const RELIGIOUS_TARGETS = list(`宗教信徒|信徒|穆斯林|伊斯兰教徒|犹太人|猶太人|基督徒|基督教徒|佛教徒|印度教徒|锡克教徒|锡克教徒|muslim|muslims|jewish|jews|christian|christians|hindu|hindus|buddhist|buddhists|sikh|sikhs|faithful|religious believers|members of another faith|members of another religion|followers of another faith|musulmans|juifs|chrétiens|chretiens|hindous|bouddhistes|sikhs|musulmanes|judíos|judios|cristianos|hindúes|hindues|buddhisten|muslime|juden|christen|judeus|muçulmanos|muculmanos|cristãos|cristaos|hindus|무슬림|유대인|기독교인|불교도|힌두교도|мусульмане|евреи|христиане|буддисты|индуисты|مسلمون|يهود|مسيحيون|بوذيون`);
const POLITICAL_TARGETS = list(`中国政府|中國政府|中国共产党|中國共產黨|中共|中国领导人|中國領導人|政府官员|政府官員|政治人物|官员|官員|议会|議會|国会|國會|国家元首|國家元首|政府大楼|政府大樓|政府机构|政府機構|中国大陆政府|中國大陸政府|government|government officials|government building|political leaders|president|prime minister|parliament|congress|state officials|party officials|gouvernement|dirigeants politiques|président|president|parlement|gobierno|dirigentes políticos|dirigentes politicos|presidente|parlamento|regierung|politische führung|politische fuhrung|präsident|prasident|parlament|governo|dirigentes políticos|presidente|parlamento|정부|정부 관리|정치 지도자|대통령|의회|政府|政府関係者|政治指導者|首相|議会|правительство|государственные чиновники|политические лидеры|президент|парламент|الحكومة|مسؤولون حكوميون|قادة سياسيون|الرئيس|البرلمان`);
const POLITICAL_VIOLENCE = list(`刺杀|刺殺|暗杀|暗殺|枪杀|槍殺|枪击|槍擊|袭击|襲擊|攻击|攻擊|爆破|袭击政府|襲擊政府|袭击官员|襲擊官員|炸毁政府|炸毀政府|炸政府|轰炸议会|轟炸議會|攻击政府大楼|攻擊政府大樓|杀死官员|殺死官員|政要暗杀|政要刺杀|assassinate|kill|murder|shoot|shooting|bomb|bombing|attack|terror attack|blow up|storm government|violent coup|tuer|assassiner|abattre|bombarder|attentat|attaquer|matar|asesinar|disparar|bombardear|atacar|atentado|töten|ermorden|erschießen|bombardieren|angreifen|anschlag|matar|assassinar|atirar|explodir|atacar|암살|살해|총격|폭파|공격|暗殺|射殺|爆破|襲撃|убить|покушение|застрелить|взорвать|атаковать|اغتيال|قتل|إطلاق النار|هجوم|تفجير`);
const TERROR_TERMS = list(`恐怖袭击|恐怖襲擊|恐怖主义|恐怖主義|恐袭|恐襲|恐怖攻击|恐怖攻擊|terrorism|terrorist attack|terrorist|extremist violence|attentat terroriste|terrorismo|terrorista|terrorismus|terroristischer anschlag|테러|테러 공격|テロ攻撃|терроризм|теракт|الإرهاب|هجوم إرهابي`);
const MASS_HARM_TERMS = list(`屠杀|屠殺|灭绝|滅絕|无差别杀人|無差別殺人|大规模枪击|大規模槍擊|炸学校|炸學校|枪击学校|槍擊學校|报复社会|報復社會|mass shooting|school shooting|kill everyone|genocide|massacre|terror attack|mass murder|tiroteo masivo|masacre|genocidio|fusillade|génocide|genocide|amoklauf|massenschießerei|genozid|massaker|mass shooting|massacre|genocídio|genocidio|массовое убийство|геноцид|مذبحة|إبادة جماعية`);
const PROFANITY_TERMS = list(`傻逼|傻屄|操你妈|操你媽|他妈的|他媽的|狗娘养的|狗娘養的|去你妈的|去你媽的|婊子|贱人|賤人|fuck|fucked|fucking|motherfucker|motherfucking|cunt|bitch|shithead|asshole|dickhead|bastard|son of a bitch|putain|connard|enculé|encule|salope|merde|hijo de puta|puta madre|mierda|cabrón|cabron|pendejo|arschloch|scheiße|scheisse|fotze|hurensohn|verdammt|filho da puta|porra|merda|씨발|시발|개새끼|좆같|くそ野郎|死ね|くたばれ|сука|блядь|блять|пиздец|мудак|ебать|пошел на хуй|иди на хуй|ابن الكلب|لعنة|قحبة|كس أمك|كلب ابن كلب`);
const ABUSE_REQUEST_TERMS = list(`辱骂|辱罵|侮辱|恶毒脏话|惡毒髒話|脏话|髒話|骂人|罵人|羞辱|人身攻击|人身攻擊|slur-filled|slur filled|abusive insult|vulgar insult|insult my coworker|write an insult|write a slur|write abusive|harass|humiliate|insulte|insulto|insultar|insulter|beleidigen|beschimpfen|욕설|모욕|侮辱文|誹謗|оскорбить|унижать|سب|إهانة`);

function add(hits, blocking, category, score, shouldBlock = true) {
  if (!hits.includes(category)) hits.push(category);
  if (shouldBlock) blocking.add(category);
  return score;
}

export function policyTextHeuristic(text) {
  const body = String(text ?? '').slice(0, 16000);
  const input = makeInput(body);
  if (!input.words) return { blocked: false, score: 0, categories: [], reason: '', source: 'policy-v3' };
  const hits = [];
  const blocking = new Set();
  let score = 0;
  const mark = (category, amount, shouldBlock = true) => { score = Math.max(score, add(hits, blocking, category, amount, shouldBlock)); };
  const safeContext = hasAny(input, SAFE_CONTEXT);
  const prevention = hasAny(input, PREVENTION_CONTEXT);
  const request = hasAny(input, REQUEST_CUES);
  const create = hasAny(input, CREATIVE_INTENT);
  const quotedContext = hasAny(input, QUOTE_OR_TRANSLATION);
  const advocacy = hasAny(input, DIRECT_HARM_INTENT);
  const advocacyRequest = advocacy && (request || hasAny(input, DIRECT_GENERATION_INTENT)) && !quotedContext;

  const minors = hasAny(input, MINOR_TERMS);
  const explicitSex = hasAny(input, SEXUAL_TERMS);
  const explicitPorn = hasAny(input, EXPLICIT_PORN_TERMS, { suffix: false });
  const tabooSex = hasAny(input, TABOO_TERMS) || (hasAny(input, FAMILY_TERMS) && explicitSex);
  const exploitativeSex = hasAny(input, EXPLOIT_TERMS) && (explicitSex || create);
  if (minors && explicitSex && (explicitPorn || create || exploitativeSex) && !(safeContext && !create && !explicitPorn)) mark('minor_sexual', 0.99);
  else if (explicitSex && (explicitPorn || create) && !(safeContext && !create)) mark('adult_sexual', 0.93);
  if (tabooSex && (explicitSex || create) && !(safeContext && !create)) mark('public_morals', 0.96);
  if (exploitativeSex && !(safeContext && !create)) mark('exploitative_sexual', 0.97);

  const safeEducationalProduct = safeContext && hasAny(input, EDUCATION_PRODUCT_CONTEXT);
  const drugPair = nearby(input, DRUG_TERMS, DRUG_ACTIONS);
  const drugHardPair = nearby(input, DRUG_TERMS, DRUG_HARD_ACTIONS);
  if (drugPair && (!safeContext || request) && !(prevention && !drugHardPair) && !safeEducationalProduct) mark('drug_crime', 0.95);

  const weaponPair = nearby(input, WEAPON_TERMS, WEAPON_ACTIONS);
  const weaponHardPair = nearby(input, WEAPON_TERMS, WEAPON_HARD_ACTIONS);
  if (weaponPair && (!safeContext || request) && !(prevention && !weaponHardPair) && !safeEducationalProduct) mark('gun_crime', 0.94);

  const actionableCrimePair = nearby(input, CRIME_ACTIONS, CRIME_OBJECTS);
  const crimeEvasion = hasAny(input, CRIME_EVASION_TERMS);
  const crimePair = actionableCrimePair || (hasAny(input, CRIME_TERMS) && request) || crimeEvasion;
  const crimeIntent = startsWithAny(input, CRIME_ACTIONS) || hasAny(input, CRIME_DIRECT_INTENT)
    || (request && (actionableCrimePair || crimeEvasion || hasAny(input, CRIME_OPERATION_TERMS)))
    || (advocacy && !safeContext && !quotedContext) || advocacyRequest;
  const victimContext = hasAny(input, CRIME_VICTIM_CONTEXT);
  if (crimePair && crimeIntent && !victimContext) mark('crime_facilitation', 0.93);

  const cyberPair = nearby(input, CYBER_TERMS, CYBER_ACTIONS);
  if (cyberPair && (!safeContext || request) && !safeEducationalProduct) mark('cyber_crime', 0.95);

  const selfHarmMention = hasAny(input, SELF_HARM_TERMS);
  const selfHarmMethod = nearby(input, SELF_HARM_TERMS, SELF_HARM_METHODS);
  const selfHarmEncouragement = hasAny(input, SELF_HARM_ENCOURAGEMENT, { suffix: false });
  const supportContext = hasAny(input, SUPPORT_CONTEXT);
  if ((selfHarmMethod || selfHarmEncouragement) && !supportContext && !safeContext && !quotedContext) mark('self_harm', 0.99);
  else if (selfHarmMention && (supportContext || safeContext || quotedContext)) mark('self_harm', 0.91, false);

  if (hasAny(input, THREAT_PATTERNS) && !safeContext && !quotedContext && !hasAny(input, THREAT_REPORT_CONTEXT)) {
    mark('credible_threat', 0.96);
  }

  const massHarm = hasAny(input, MASS_HARM_TERMS);
  const massIntent = advocacyRequest || (advocacy && !safeContext && !quotedContext) || (request && !safeContext && !quotedContext);
  if (massHarm && massIntent) mark('mass_harm', 0.97);

  const hatePair = nearby(input, HATE_TARGETS, HATE_ACTIONS) || nearby(input, HATE_ACTIONS, HATE_TARGETS);
  if (hatePair) mark('hate', 0.96, (!safeContext && !quotedContext) || advocacyRequest);

  const politicalPair = nearby(input, POLITICAL_TARGETS, POLITICAL_VIOLENCE) || nearby(input, POLITICAL_VIOLENCE, POLITICAL_TARGETS);
  const politicalIntent = advocacyRequest || ((advocacy || request) && !safeContext && !quotedContext);
  if ((politicalPair || (hasAny(input, TERROR_TERMS) && hasAny(input, POLITICAL_TARGETS))) && politicalIntent) {
    mark('political_violence', 0.97);
  }

  const religiousPair = nearby(input, RELIGIOUS_TARGETS, [...HATE_ACTIONS, ...POLITICAL_VIOLENCE])
    || (hasAny(input, RELIGIOUS_TARGETS) && hasAny(input, TERROR_TERMS));
  if (religiousPair) mark('religious_extremism', 0.97, (!safeContext && !quotedContext) || advocacyRequest);

  const profanity = hasAny(input, PROFANITY_TERMS, { suffix: false }) || hasObfuscatedAny(input, PROFANITY_TERMS);
  const abusiveRequest = create && hasAny(input, ABUSE_REQUEST_TERMS);
  if (profanity || abusiveRequest) {
    const quoted = hasAny(input, QUOTE_OR_TRANSLATION) || (safeContext && !create);
    mark('severe_profanity', 0.92, !quoted || abusiveRequest);
  }

  return {
    blocked: blocking.size > 0,
    score,
    categories: hits,
    reason: hits.join(', '),
    source: 'policy-v3',
  };
}
