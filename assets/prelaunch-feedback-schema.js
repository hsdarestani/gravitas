/* One questionnaire definition for public form and admin reporting.
   Visible question numbers are assigned at render time; never hard-code them here.
   Original answer keys and expanded sections remain unchanged. */
export const GROUPS = [
  { id:'about', letter:'A', title:'About you', note:'Your perspective helps us understand responses.', fields:[
    { key:'persona', label:'Which description fits you best?', type:'persona', options:[
      ['a1','Curious Explorer','I enjoy discovering science without needing technical detail.'],
      ['a2','Early-Career Researcher','I am studying or starting out in scientific research.'],
      ['a3','Working Scientist','Research is part of my professional work.'],
      ['other','Other / None of these','I see myself differently.']
    ] },
    { key:'persona_other', label:'If other, how would you describe yourself?', type:'text', max:160, gate:'persona:other' },
    { key:'name', label:'Your name (leave blank to remain anonymous)', type:'input', max:120 }
  ]},
  { id:'first', letter:'B', title:'First impression and goals', note:'What did you think GraviQuest was trying to achieve?', fields:[
    {key:'site_works', star:true, label:'Overall, how well does the site work?', type:'score5', low:'Not well', high:'Very well'},
    {key:'goals_clear', star:true, label:'How clear are the site’s goals?', type:'score5', low:'Not clear', high:'Very clear'},
    {key:'site_purpose', label:'In your own words, what is this site trying to do?', type:'text', extra:true},
    {key:'target_audience', label:'Who do you think this site is for?', type:'text', extra:true},
    {key:'trustworthy', label:'How trustworthy does the site feel?', type:'score5', low:'Not at all', high:'Very trustworthy', extra:true},
    {key:'first_impression', label:'What was your very first impression?', type:'text', extra:true},
    {key:'expectations_difference', label:'How different was the experience from what you expected?', type:'score5', low:'As expected', high:'Very different', extra:true}
  ]},
  { id:'technical', letter:'C', title:'Navigation and technical', note:'Finding things and using the site on your device.', fields:[
    {key:'findability', star:true, label:'How easy was it to find what you were looking for?', type:'score5', low:'Very difficult', high:'Very easy'},
    {key:'anything_broken', label:'Did anything break, look wrong, or not work?', type:'yesno'},
    {key:'broken_where', label:'Where did you notice the problem?', type:'text', gate:'anything_broken:yes'},
    {key:'page_speed', label:'How quickly did pages and videos load?', type:'score5', low:'Very slowly', high:'Very quickly', extra:true},
    {key:'device_experience', label:'How well did the site work on your device?', type:'score5', low:'Not well', high:'Very well', extra:true}
  ]},
  { id:'visual', letter:'D', title:'Look and feel', note:'Your reaction to the design and readability.', fields:[
    {key:'visual_attractiveness', star:true, label:'How visually attractive is the site?', type:'score5', low:'Not attractive', high:'Very attractive'},
    {key:'text_readability', label:'How easy is the text to read (font, size, contrast)?', type:'score5', low:'Very difficult', high:'Very easy', extra:true},
    {key:'visual_feedback', label:'Any other comments about the visual design?', type:'text', extra:true}
  ]},
  { id:'topics', letter:'E', title:'Topics section', note:'Tell us about the topic overview and what you would like to explore next.', fields:[
    {key:'topics_clarity', label:'How easy is it to see what each topic is about?', type:'score5', low:'Not easy', high:'Very easy'},
    {key:'future_topics', label:'Which future topics would interest you most?', type:'text', extra:true}
  ]},
  { id:'topic01', letter:'F', title:'Topic 01', note:'Is AI reliable in research? Only rate the parts you explored.', fields:[
    {key:'topic_interest', star:true, label:'How interesting is Topic 01 for you?', type:'score5', low:'Not interesting', high:'Very interesting'},
    {key:'topic_quality', star:true, label:'How would you rate the overall quality of Topic 01?', type:'score5', low:'Poor', high:'Excellent'},
    {key:'video_watched', label:'Did you watch the video?', type:'select', options:[['all','All of it'],['part','Part of it'],['no','No']]},
    {key:'video_content_quality', star:true, label:'How good was the content of the video?', type:'score5', low:'Poor', high:'Excellent', gate:'video_watched:all,part'},
    {key:'topic_difficulty', label:'How difficult was it?', type:'select', options:[['too_easy','Too easy'],['about_right','About right'],['too_hard','Too hard']], extra:true},
    {key:'topic_length', label:'How long was it?', type:'select', options:[['too_short','Too short'],['about_right','About right'],['too_long','Too long']], extra:true},
    {key:'explanations_clarity', label:'How clear were the explanations?', type:'score5', low:'Not clear', high:'Very clear', extra:true},
    {key:'learning_gain', label:'How much did you learn?', type:'score5', low:'Nothing new', high:'A lot', extra:true},
    {key:'video_visuals', label:'How visually attractive was the video?', type:'score5', low:'Not attractive', high:'Very attractive', gate:'video_watched:all,part', extra:true},
    {key:'video_audio', label:'How good were the sound and narration?', type:'score5', low:'Poor', high:'Excellent', gate:'video_watched:all,part', extra:true},
    {key:'video_pace', label:'How was the pace of the video?', type:'select', options:[['too_slow','Too slow'],['about_right','About right'],['too_fast','Too fast']], gate:'video_watched:all,part', extra:true},
    {key:'video_stop_reason', label:'If you stopped the video early, why?', type:'text', gate:'video_watched:part', extra:true},
    {key:'topic_best_part', label:'What was the most interesting or useful part of Topic 01?', type:'text', extra:true},
    {key:'topic_improvements', label:'What was confusing, or what could be better?', type:'text', extra:true},
    {key:'video_feedback', label:'Any other thoughts about the video?', type:'text', gate:'video_watched:all,part', extra:true},
    {key:'scientific_content_feedback', label:'Any other comments on the scientific content?', type:'text', extra:true}
  ]},
  { id:'community', letter:'G', title:'Community and discussion forum', note:'If you did not visit, you can skip this entire section.', fields:[
    {key:'community_visited', label:'Did you visit the Community page or forum?', type:'yesno'},
    {key:'community_purpose', label:'How clear is the purpose of the Community section?', type:'score5', low:'Not clear', high:'Very clear', gate:'community_visited:yes'},
    {key:'forum_usability', label:'How easy was the forum to use (reading, posting, replying)?', type:'score5', low:'Very difficult', high:'Very easy', gate:'community_visited:yes', extra:true},
    {key:'forum_participation', label:'How likely are you to post or reply in the forum?', type:'score5', low:'Very unlikely', high:'Very likely', gate:'community_visited:yes', extra:true},
    {key:'forum_motivation', label:'What would make you more likely to join the discussions?', type:'text', gate:'community_visited:yes', extra:true}
  ]},
  { id:'future', letter:'H', title:'Coming soon: Lab and Learn', note:'These features are not available in this prelaunch. We are asking about expectations, not usability.', fields:[
    {key:'lab_learn_expectations', label:'What would you expect to find in Lab? And in Learn?', type:'text'}
  ]},
  { id:'overall', letter:'I', title:'Overall', note:'Think about your experience as a whole.', fields:[
    {key:'return_likelihood', star:true, label:'How likely are you to come back to the site?', type:'score5', low:'Very unlikely', high:'Very likely'},
    {key:'recommend_likelihood', star:true, label:'How likely are you to recommend the site to a friend or colleague?', type:'score10', low:'Not at all likely', high:'Extremely likely'},
    {key:'one_change', star:true, label:'If you could change one thing, what would it be?', type:'text'}
  ]},
  { id:'final_comments', letter:'J', title:'Final comments and suggestions', note:'Have a specific criticism, suggestion or anything else to add? Tell us here.', fields:[
    {key:'other_feedback', label:'Anything else you would like to tell us?', type:'text'},
    {key:'contact_email', label:'May we contact you with follow-up questions? Leave your email only if you agree.', type:'email', max:254, hint:'Adding your email gives us permission to contact you about this feedback only. No marketing subscription.'}
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
