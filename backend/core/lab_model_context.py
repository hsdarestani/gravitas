"""Compact, version-bound facts for explaining the actual Science Universe engine.

Papers explain concepts; these facts describe this exact implementation. Refuse
to attach them to a different engine instead of silently teaching old rules.
"""
import hashlib
import math

ENGINE_SHA = 'b747c91da73c6832a9d07678d6ceb009eb131843068d6d5e81dc0dc10d3aa351'
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
        'missing_values_use_model_defaults': [k for k in DEFAULTS if k not in supplied],
        'computed_mechanism_example': {
            'initial_analyses_at_current_pressure_and_transparency': analyses(policy['transparency']),
            'initial_analyses_if_only_transparency_is_10': analyses(10),
            'replication_analyses': 1,
            'interpretation': 'The smallest p-value among these initial analyses is selected without correction. Raising transparency cannot increase this count. This calculation is not an observed research outcome.',
        },
    }
