/* One questionnaire definition for public form and admin reporting.
   The original Ahmad survey is preserved; expanded sections remain optional. */
export const GROUPS = [
  { id:'about', letter:'A', title:'About you', note:'Optional. Your perspective helps us understand responses.', fields:[
    { key:'persona', label:'Which description fits you best?', type:'persona', options:[
      ['a1','Curious Explorer','I enjoy discovering science without needing technical detail.'],
      ['a2','Early-Career Researcher','I am studying or starting out in scientific research.'],
      ['a3','Working Scientist','Research is part of my professional work.'],
      ['other','Other / None of these','I see myself differently.']
    ] },
    { key:'persona_other', label:'If other, how would you describe yourself?', type:'text', max:160, gate:'persona:other', extra:true },
    { key:'name', label:'Your name (leave blank to remain anonymous)', type:'input', max:120 }
  ]},
  { id:'first', letter:'B', title:'First impression and goals', note:'What did you think GraviQuest was trying to achieve?', fields:[
    {key:'site_works', number:5, star:true, label:'Overall, how well does the site work?', type:'score5', low:'Not well', high:'Very well'},
    {key:'goals_clear', number:6, star:true, label:'How clear are the site’s goals?', type:'score5', low:'Not clear', high:'Very clear'},
    {key:'site_purpose', number:7, label:'In your own words, what is this site trying to do?', type:'text', extra:true},
    {key:'target_audience', number:8, label:'Who do you think this site is for?', type:'text', extra:true},
    {key:'trustworthy', number:9, label:'How trustworthy does the site feel?', type:'score5', low:'Not at all', high:'Very trustworthy', extra:true},
    {key:'first_impression', label:'What was your very first impression?', type:'text', extra:true},
    {key:'expectations_difference', label:'How different was the experience from what you expected?', type:'score5', low:'As expected', high:'Very different', extra:true}
  ]},
  { id:'technical', letter:'C', title:'Navigation and technical', note:'Finding things and using the site on your device.', fields:[
    {key:'findability', number:10, star:true, label:'How easy was it to find what you were looking for?', type:'score5', low:'Very difficult', high:'Very easy'},
    {key:'anything_broken', number:12, label:'Did anything break, look wrong, or not work?', type:'yesno'},
    {key:'broken_where', label:'Where did you notice the problem?', type:'text', gate:'anything_broken:yes'},
    {key:'page_speed', number:11, label:'How quickly did pages and videos load?', type:'score5', low:'Very slowly', high:'Very quickly', extra:true},
    {key:'device_experience', number:13, label:'How well did the site work on your device?', type:'score5', low:'Not well', high:'Very well', extra:true}
  ]},
  { id:'visual', letter:'D', title:'Look and feel', note:'Your reaction to the design and readability.', fields:[
    {key:'visual_attractiveness', number:14, star:true, label:'How visually attractive is the site?', type:'score5', low:'Not attractive', high:'Very attractive'},
    {key:'text_readability', number:15, label:'How easy is the text to read (font, size, contrast)?', type:'score5', low:'Very difficult', high:'Very easy', extra:true},
    {key:'visual_feedback', label:'Any other comments about the visual design?', type:'text', extra:true}
  ]},
  { id:'topics', letter:'E', title:'Topics section', note:'Tell us about the topic overview and what you would like to explore next.', fields:[
    {key:'topics_clarity', number:16, label:'How easy is it to see what each topic is about?', type:'score5', low:'Not easy', high:'Very easy'},
    {key:'future_topics', number:17, label:'Which future topics would interest you most?', type:'text', extra:true}
  ]},
  { id:'topic01', letter:'F', title:'Topic 01', note:'Is AI reliable in research? Only rate the parts you explored.', fields:[
    {key:'topic_interest', number:18, star:true, label:'How interesting is Topic 01 for you?', type:'score5', low:'Not interesting', high:'Very interesting'},
    {key:'topic_quality', number:19, star:true, label:'How would you rate the overall quality of Topic 01?', type:'score5', low:'Poor', high:'Excellent'},
    {key:'video_watched', number:24, label:'Did you watch the video?', type:'select', options:[['all','All of it'],['part','Part of it'],['no','No']]},
    {key:'video_content_quality', number:25, star:true, label:'How good was the content of the video?', type:'score5', low:'Poor', high:'Excellent', gate:'video_watched:all,part'},
    {key:'topic_difficulty', number:20, label:'How difficult was it?', type:'select', options:[['too_easy','Too easy'],['about_right','About right'],['too_hard','Too hard']], extra:true},
    {key:'topic_length', number:21, label:'How long was it?', type:'select', options:[['too_short','Too short'],['about_right','About right'],['too_long','Too long']], extra:true},
    {key:'explanations_clarity', number:22, label:'How clear were the explanations?', type:'score5', low:'Not clear', high:'Very clear', extra:true},
    {key:'learning_gain', number:23, label:'How much did you learn?', type:'score5', low:'Nothing new', high:'A lot', extra:true},
    {key:'video_visuals', number:26, label:'How visually attractive was the video?', type:'score5', low:'Not attractive', high:'Very attractive', gate:'video_watched:all,part', extra:true},
    {key:'video_audio', number:27, label:'How good were the sound and narration?', type:'score5', low:'Poor', high:'Excellent', gate:'video_watched:all,part', extra:true},
    {key:'video_pace', number:28, label:'How was the pace of the video?', type:'select', options:[['too_slow','Too slow'],['about_right','About right'],['too_fast','Too fast']], gate:'video_watched:all,part', extra:true},
    {key:'video_stop_reason', number:29, label:'If you stopped the video early, why?', type:'text', gate:'video_watched:part', extra:true},
    {key:'topic_best_part', number:30, label:'What was the most interesting or useful part of Topic 01?', type:'text', extra:true},
    {key:'topic_improvements', number:31, label:'What was confusing, or what could be better?', type:'text', extra:true},
    {key:'video_feedback', label:'Any other thoughts about the video?', type:'text', gate:'video_watched:all,part', extra:true},
    {key:'scientific_content_feedback', label:'Any other comments on the scientific content?', type:'text', extra:true}
  ]},
  { id:'community', letter:'G', title:'Community and discussion forum', note:'If you did not visit, you can skip this entire section.', fields:[
    {key:'community_visited', number:32, label:'Did you visit the Community page or forum?', type:'yesno'},
    {key:'community_purpose', number:33, label:'How clear is the purpose of the Community section?', type:'score5', low:'Not clear', high:'Very clear', gate:'community_visited:yes'},
    {key:'forum_usability', number:34, label:'How easy was the forum to use (reading, posting, replying)?', type:'score5', low:'Very difficult', high:'Very easy', gate:'community_visited:yes', extra:true},
    {key:'forum_participation', number:35, label:'How likely are you to post or reply in the forum?', type:'score5', low:'Very unlikely', high:'Very likely', gate:'community_visited:yes', extra:true},
    {key:'forum_motivation', number:36, label:'What would make you more likely to join the discussions?', type:'text', gate:'community_visited:yes', extra:true}
  ]},
  { id:'future', letter:'H', title:'Coming soon: Lab and Learn', note:'These features are not available in this prelaunch. We are asking about expectations, not usability.', fields:[
    {key:'lab_learn_expectations', number:38, label:'What would you expect to find in Lab? And in Learn?', type:'text'}
  ]},
  { id:'overall', letter:'I', title:'Overall', note:'Your final thoughts, and optional contact details.', fields:[
    {key:'return_likelihood', number:40, star:true, label:'How likely are you to come back to the site?', type:'score5', low:'Very unlikely', high:'Very likely'},
    {key:'recommend_likelihood', number:41, star:true, label:'How likely are you to recommend the site to a friend or colleague?', type:'score10', low:'Not at all likely', high:'Extremely likely'},
    {key:'one_change', number:42, star:true, label:'If you could change one thing, what would it be?', type:'text'},
    {key:'other_feedback', number:43, label:'Anything else you would like to tell us?', type:'text', extra:true},
    {key:'contact_email', number:44, label:'May we contact you with follow-up questions? Leave your email only if you agree.', type:'email', max:254, extra:true, hint:'Adding your email gives us permission to contact you about this feedback only. No marketing subscription.'}
  ]}
];
export const FIELDS = GROUPS.flatMap(group => group.fields);
export const FIELD_BY_KEY = Object.fromEntries(FIELDS.map(field => [field.key, field]));
export const PRIORITY_KEYS = FIELDS.filter(field => field.star).map(field => field.key);
export const LEGACY_LABELS = [
  ['overall_rating','Previous form — Overall / 10'],
  ['usability','Previous form — Ease / 5 (lower = easier)'],
  ['section_ratings','Previous form — Section ratings']
];
