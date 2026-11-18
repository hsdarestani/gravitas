// The site footer, under every Forum page, so the Forum ends the way every
// page on graviquest.com does (2026-11-18: the owner compared the Forum with
// the approved prototype and the footer was missing). The markup is
// community.html's footer with its links made absolute; common.scss styles it
// under .gq-footer, because Discourse does not load the site's gravitas.css.
import Component from "@glimmer/component";

export default class GraviQuestFooter extends Component {
  <template>
    <footer class="gq-footer">
      <div class="g-container">
        <div class="g-footer__grid">
          <div>
            <div ><span class="gq-footer__logo" role="img" aria-label="GraviQuest"></span></div>
            <p class="g-mt-sm g-subtle" >
              A community drawn together by the weighty questions in science and AI, with a forum to talk them through.</p>
          </div>
          <div><h5 class="g-footer__heading">Explore</h5>
            <div class="g-stack g-stack--xs g-stack--ic"><a href="https://graviquest.com/topics.html"><svg class="g-ic g-ic--sm" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" shape-rendering="geometricPrecision"><g transform="translate(2.282 2.283) scale(1.0407)" stroke-width="1.634"><rect x=".75" y=".75" width="17.2" height="17.2" rx="3.4" ry="3.4"/><path d="M.85,7.95c3.5,1.5,6,2.3,8.5,2.3s5-.8,8.5-2.3"/><path d="M7.95.85c1.5,3.5,2.3,6,2.3,8.5s-.8,5-2.3,8.5"/></g></svg><span>Topics</span></a><a href="https://graviquest.com/lab.html"><svg class="g-ic g-ic--sm" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" shape-rendering="geometricPrecision"><g transform="translate(4.844 0.9) scale(0.972826)" stroke-width="1.747"><path d="M4.7.75h5.2"/><path d="M5.9.75c0,8.29.39,6.94-4.03,13.95l-.79,1.25c-.89,1.41.12,3.2,1.8,3.2h9.04c1.68,0,2.69-1.79,1.8-3.2l-.79-1.25c-4.42-7.01-4.03-5.66-4.03-13.95"/><circle cx="7.3" cy="14.8" r="1.593" fill="currentColor" stroke="none"/></g></svg><span>Interactive Lab</span></a><a href="https://graviquest.com/learn.html"><svg class="g-ic g-ic--sm" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" shape-rendering="geometricPrecision"><g transform="translate(2.353 2.45) scale(0.962366)" stroke-width="1.766"><path d="M4.45,17.15c3-.8,3.2-5.8,5.6-7.2"/><path d="M10.05,9.95c2.4-1.4,2.6-6.4,5.6-7.2"/><circle cx="2.35" cy="17.55" r="1.6"/><circle cx="17.75" cy="2.35" r="1.6"/><circle cx="10.05" cy="9.95" r="1.611" fill="currentColor" stroke="none"/></g></svg><span>Learning Paths</span></a></div></div>
          <div><h5 class="g-footer__heading">Join in</h5>
            <div class="g-stack g-stack--xs g-stack--ic"><a href="https://graviquest.com/community"><svg class="g-ic g-ic--sm" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" shape-rendering="geometricPrecision"><g transform="translate(2.252 1.167) scale(1.09681)" stroke-width="1.55"><circle cx="8.91" cy="2.5" r="1.75"/><circle cx="15.32" cy="13.6" r="1.75"/><circle cx="2.5" cy="13.6" r="1.75"/><circle cx="8.91" cy="9.9" r="1.413" fill="currentColor" stroke="none"/></g></svg><span>Community</span></a><span class="g-foot-soon" aria-disabled="true"><svg class="g-ic g-ic--sm" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" shape-rendering="geometricPrecision"><g transform="translate(2.332 4.76) scale(0.994444)" stroke-width="1.709"><path d="M1.98,2.26c2.88,5.22,5.41,7.83,7.77,7.83s4.89-2.61,7.77-7.83"/><path d="M18.39,3.84c.47,2.28.48,4.67,0,7.03-.29,1.44-1.47,2.53-2.92,2.73-3.8.51-7.66.51-11.46,0-1.45-.19-2.62-1.27-2.91-2.7-.47-2.28-.48-4.67,0-7.03.29-1.44,1.47-2.53,2.92-2.73,3.8-.51,7.66-.51,11.46,0,1.45.19,2.62,1.27,2.91,2.7Z"/><circle cx="9.75" cy="7.11" r="1.559" fill="currentColor" stroke="none"/></g></svg><span>Newsletter</span><span class="g-soon">Soon</span></span></div></div>
          <div><h5 class="g-footer__heading">Follow</h5><ul class="lp-social"><li><a class="lp-social__link" href="https://www.youtube.com/@GraviQuest" target="_blank" rel="noopener" aria-label="YouTube"><svg viewBox="0 0 24 24" shape-rendering="geometricPrecision" fill="none" stroke="currentColor" stroke-width="1.7"><g transform="translate(1.083 1.066) scale(0.9133)" stroke-width="1.861"><rect x="2.2" y="5.2" width="19.6" height="13.6" rx="4.2"/><path d="M10.3 9.4v5.2l4.5-2.6z" fill="currentColor" stroke="none"/></g></svg></a></li><li><a class="lp-social__link" href="https://www.linkedin.com/company/graviquest/" target="_blank" rel="noopener" aria-label="LinkedIn"><svg viewBox="0 0 24 24" shape-rendering="geometricPrecision" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><g transform="translate(0.207 -0.239) scale(0.9944)" stroke-width="1.709"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M7.6 10.6V17"/><circle cx="7.6" cy="7.5" r="1.05" fill="currentColor" stroke="none"/><path d="M11.4 17v-3.6a2.6 2.6 0 0 1 5.2 0V17"/><path d="M11.4 17v-6.4"/></g></svg></a></li><li><a class="lp-social__link" href="https://www.instagram.com/graviquest" target="_blank" rel="noopener" aria-label="Instagram"><svg viewBox="0 0 24 24" shape-rendering="geometricPrecision" fill="none" stroke="currentColor" stroke-width="1.7"><g transform="translate(-0.043 0.227) scale(0.9944)" stroke-width="1.709"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4.1"/><circle cx="17.1" cy="6.9" r="1.15" fill="currentColor" stroke="none"/></g></svg></a></li></ul></div>
        </div>
        <div class="g-footer__legal">
          <span class="g-footer__fine">&copy; 2026 GraviQuest<a href="https://graviquest.com/about.html">About</a><a href="https://graviquest.com/impressum.html">Legal Notice</a><a href="https://graviquest.com/privacy.html">Privacy</a></span>
          <span>Curiosity draws people in. Capability keeps them in orbit.</span>
        </div>
      </div>
    </footer>
  </template>
}
