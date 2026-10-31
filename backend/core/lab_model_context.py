"""Compact, version-bound facts for explaining the actual Science Universe engine.

Papers explain concepts; these facts describe this exact implementation. Refuse
to attach them to a different engine instead of silently teaching old rules.
"""
import hashlib
import math

ENGINE_SHA = '40fe6ac6d23b36ec6b7908899485ee39cb501ce4d7af334a1b54cdb731f9a5d6'
DEFAULTS = dict(generation=5, verification=5, replication=4, funding=6, aiAdoption=6,
                alpha=5, sampleSize=5, transparency=5, diversity=5, pressure=5,
                network=5, uncertainty=5)
RULES = {
    'generation': 'Changes the daily chance of generating a hypothesis; generation is not evidence or publication.',
    'verification': 'Daily review capacity=floor(1+0.55*verification). Also changes review rigor and the assumed withdrawal threshold. Review cannot see hidden truth.',
    'replication': 'Repeat capacity=floor(replication/3)+1 per day; repeat effective sample factor=0.86+0.025*replication. A fresh independent test can succeed or fail; it does not guarantee truth.',
    'funding': 'Daily credit inflow=6+3*funding; up to 65% is automatically distributed. Resources affect which studies can run, not alpha or hidden truth directly.',
    'aiAdoption': 'Changes generation multipliers: AI=0.35+aiAdoption/10; human=0.65+(10-aiAdoption)/22. This is separate from the initial fraction of AI roles. Actors are simulated rules, not LLMs.',
    'alpha': 'Significance threshold=clamp(0.005*2**(0.43*alpha),0.007,0.18). A larger threshold permits more null results to pass the test.',
    'sampleSize': 'Nominal n=18+16*sampleSize, then method/replication factors apply. Larger n improves power for a fixed nonzero effect and costs more research credits.',
    'transparency': 'Open methods REDUCES selective extra analyses: extra=max(0,floor((pressure-5)/2)-floor(transparency/5)). Registered-plan probability=transparency/10. It also adds 0.017*transparency to review rigor. It does NOT increase the number of candidate relationships or directly add extra tests.',
    'diversity': 'Out-of-specialty topic search: probability diversity/16 of choosing a uniformly random field, which may still be the original field. With field-specific priors it also shifts assumed truth priors; a common prior removes that shift. There is no calibrated interdisciplinarity bonus.',
    'pressure': 'Publication pressure can add uncorrected selective analyses and reduce review rigor. Total initial analyses=1+max(0,floor((pressure-5)/2)-floor(transparency/5)); it does not directly raise hypothesis-generation chance.',
    'network': 'Every third model day, ceil(network/2) citation attempts spread attention. Citation opportunities can queue repeat tests. More attention is not proof of truth.',
    'uncertainty': 'AI abstention multiplies generation chance by clamp(1-0.075*(uncertainty-1)*(1-agent.rigour),0.47,1). This assumed caution mechanism reduces some AI proposals; it is not measured LLM uncertainty.',
}


def model_facts(lab, state):
    engine = next((f.get('content', '') for f in lab.published_files if f.get('name') == 'engine.js'), '')
    if hashlib.sha256(engine.encode()).hexdigest() != ENGINE_SHA:
        return {'verified_engine_match': False, 'note': 'No version-matched mechanism card; use stored sources cautiously.'}
    supplied = state.get('policies', {})
    policy = {k: supplied[k] if type(supplied.get(k)) in (int, float) and
              supplied[k] == int(supplied[k]) and 1 <= supplied[k] <= 10 else v
              for k, v in DEFAULTS.items()}
    analyses = lambda transparency: 1 + max(0, math.floor((policy['pressure']-5)/2)-math.floor(transparency/5))
    return {
        'verified_engine_match': True, 'engine_sha': ENGINE_SHA,
        'basis': 'Exact implemented mechanisms, not empirical findings from papers.',
        'rules': RULES, 'policy_values': policy,
        'graph_mechanisms': {
            'laboratories_view': 'Nodes are actual labs; radius follows active studies with a display cap. Static team marks represent actual AI/human members, not work-rate measurements.',
            'knowledge_flow_view': 'Dots are up to 180 recent live papers, grouped in lanes by topic field and ordered by publication day with collision-avoiding display slots; smaller canvases keep the newest claims in each field within the available space. Select one claim to reveal its retained citation arrows from citing labs; the engine retains at most 120 events. Dot positions are display layout only and do not change scientific outcomes. Field chips filter the display, not the numerical model.',
            'citation_motion': 'A moving mark encodes the age of a recorded citation across eight model days, not a measured speed of knowledge transmission. Pause freezes model-day motion.',
            'moving_a_lab': 'Changes normalized network distance and possible collaboration edges. Same-field neighbors within distance .49 link; other near pairs within .24 use a fixed affinity threshold .74. Moving does not reroll unrelated affinities or consume the experiment random stream.',
            'citation_preference': 'Weight=(1+sqrt(paper citations+1)) * (1.7 if linked else 1) * (1.8 if paper topic matches citing lab field else .65). This is a relative weight, not a probability or evidence of truth.',
            'downstream_effect': 'A changed citation target can trigger a repeat request with probability .012*replication. Moving does not directly change hidden truth, study data, statistical power, methods or funding.',
            'interdisciplinary_work': 'A generated question can use a topic outside its origin lab field. The exact out-of-field chance is (diversity/16)*(3/4), because uniform field choice can return the original field. Cross-field citations and links are separate measures. Joint authorship or combined scientific methods are not simulated.',
            'current_out_of_field_probability': policy['diversity']*3/64,
            'paper_colors': 'Gold=no completed repeat; green=at least one passed and no failed repeat; orange=one or more failed repeats. Colors do not reveal hidden truth. The outer color marks topic field, with an extra violet ring for out-of-field work.',
        },
        'missing_values_use_model_defaults': [k for k in DEFAULTS if k not in supplied],
        'computed_mechanism_example': {
            'initial_analyses_at_current_pressure_and_transparency': analyses(policy['transparency']),
            'initial_analyses_if_only_transparency_is_10': analyses(10),
            'replication_analyses': 1,
            'interpretation': 'The smallest p-value among these initial analyses is selected without correction. Raising transparency cannot increase this count. This calculation is not an observed research outcome.',
        },
    }
