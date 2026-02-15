// Article Wizard Logic
document.addEventListener('DOMContentLoaded', () => {
    // --- State Management ---
    const wizardCtx = document.getElementById('wizard-app');
    if (!wizardCtx) return;

    const { existingArticle, initialConfig, initialBlocks } = JSON.parse(wizardCtx.dataset.initialState);

    const state = {
        step: existingArticle ? 4 : 1, // Jump to review/publish if editing
        config: initialConfig || {},
        outline: existingArticle ? {
            title: existingArticle.title,
            seo_title: existingArticle.seo_title,
            meta_description: existingArticle.description,
            slug: existingArticle.slug,
            sections: [] // We might lost sections structure if not saved separately, but we have blocks
        } : null,
        generatedBlocks: initialBlocks || []
    };

    // Pre-fill inputs if editing
    if (existingArticle) {
        // Fill Step 1 inputs for context
        if (state.config.target_keyword) {
            const el = document.getElementById('target_keyword');
            if (el) el.value = state.config.target_keyword;
        }
        if (state.config.article_type) {
            const el = document.getElementById('article_type');
            if (el) el.value = state.config.article_type;
        }

        // Handle platforms check
        if (state.config.platforms && Array.isArray(state.config.platforms)) {
            state.config.platforms.forEach(pid => {
                const cb = document.querySelector(`input[name="platforms"][value="${pid}"]`);
                if (cb) cb.checked = true;
            });
        }

        // Fill Review Screen
        const titleEl = document.getElementById('final-title');
        if (titleEl) titleEl.innerText = existingArticle.title;

        const descEl = document.getElementById('final-description');
        if (descEl) descEl.innerText = existingArticle.description;

        // Fill Hero Image
        if (existingArticle.heroImage) {
            const previewEl = document.getElementById('hero-image-preview');
            if (previewEl) previewEl.innerHTML = `<img src="${existingArticle.heroImage}" alt="Hero" class="rounded-lg max-h-[300px] object-cover w-full" />`;

            const statusEl = document.getElementById('hero-image-status');
            if (statusEl) statusEl.innerText = 'Huidige afbeelding';

            // Disable generate by default if exists
            const genCheck = document.getElementById('generate_hero_image');
            if (genCheck) genCheck.checked = false;

            // Re-enable image config opacity change logic
            const imageConfig = document.getElementById('image-config');
            if (imageConfig) {
                imageConfig.style.opacity = '0.4';
                imageConfig.style.pointerEvents = 'none';
            }
        }

        // Update button text
        const pubBtn = document.getElementById('publish-btn');
        if (pubBtn) pubBtn.innerText = 'UPDATEN';
    }

    // --- DOM Elements ---
    const steps = document.querySelectorAll('.wizard-step');
    const stepIndicators = document.querySelectorAll('.step-indicator');

    // --- Functions ---
    function setStep(newStep) {
        state.step = newStep;

        // Update UI visibility
        steps.forEach(el => el.classList.add('hidden'));
        const stepEl = document.getElementById(`step-${newStep}`);
        if (stepEl) stepEl.classList.remove('hidden');

        // Update indicators
        stepIndicators.forEach(el => {
            const s = parseInt(el.dataset.step);
            const circle = el.querySelector('.step-circle');
            const label = el.querySelector('.step-label');

            if (s === newStep) {
                circle.classList.add('bg-navy', 'text-white', 'border-navy');
                circle.classList.remove('bg-white/50', 'text-muted', 'border-navy/10', 'bg-green-600', 'border-green-600');
                label.classList.add('text-navy');
                label.classList.remove('text-muted');
            } else if (s < newStep) {
                circle.classList.add('bg-green-600', 'text-white', 'border-green-600');
                circle.classList.remove('bg-white/50', 'text-muted', 'border-navy/10', 'bg-navy', 'text-white', 'border-navy');
            } else {
                circle.classList.remove('bg-navy', 'text-white', 'border-navy', 'bg-green-600', 'border-green-600');
                circle.classList.add('bg-white/50', 'text-muted', 'border-navy/10');
                label.classList.remove('text-navy');
                label.classList.add('text-muted');
            }
        });
        window.scrollTo(0, 0);
    }

    // --- Step 1: Generate Outline ---
    const genOutlineBtn = document.getElementById('generate-outline-btn');
    if (genOutlineBtn) {
        genOutlineBtn.addEventListener('click', async (e) => {
            const btn = e.target.closest('button');
            const spinner = btn.querySelector('.loading-spinner');

            // Collect config
            const platforms = Array.from(document.querySelectorAll('input[name="platforms"]:checked')).map(el => el.value);

            const targetKeyword = document.getElementById('target_keyword')?.value;
            if (!targetKeyword) return alert('Vul een keyword in');

            state.config = {
                target_keyword: targetKeyword,
                article_type: document.getElementById('article_type')?.value || undefined,
                monetization_priority: document.getElementById('monetization_priority')?.value,
                tone: document.getElementById('tone')?.value,
                include_faq: document.getElementById('include_faq')?.checked,
                target_audience: document.getElementById('target_audience')?.value,
                article_angle: document.getElementById('article_angle')?.value,
                custom_instructions: document.getElementById('custom_instructions')?.value,
                model_provider: document.querySelector('input[name="model_provider"]:checked')?.value || 'openai',
                generate_hero_image: document.getElementById('generate_hero_image')?.checked,
                image_provider: document.getElementById('image_provider')?.value,
                image_style: document.getElementById('image_style')?.value,
                platforms
            };


            // UI Loading state
            btn.disabled = true;
            spinner.classList.remove('hidden');

            try {
                const res = await fetch('/api/generate/outline', {
                    method: 'POST',
                    body: JSON.stringify({
                        ...state.config,
                        model_provider: state.config.model_provider
                    })
                });
                const data = await res.json();

                if (data.error) throw new Error(data.error);

                state.outline = data.outline;
                renderOutline(state.outline);
                setStep(2);

            } catch (err) {
                alert('Fout: ' + err.message);
            } finally {
                btn.disabled = false;
                spinner.classList.add('hidden');
            }
        });
    }

    function renderOutline(outline) {
        const seoTitle = document.getElementById('seo_title');
        if (seoTitle) seoTitle.value = outline.seo_title;

        const slugInput = document.getElementById('slug');
        if (slugInput) slugInput.value = outline.slug;

        const container = document.getElementById('outline-sections');
        if (!container) return;
        container.innerHTML = '';

        outline.sections.forEach((section, idx) => {
            appendSection(section);
        });
    }

    function appendSection(section) {
        const container = document.getElementById('outline-sections');
        if (!container) return;

        const div = document.createElement('div');
        div.className = 'p-4 bg-gray-950 rounded-lg border border-gray-800 flex gap-4 group transition-all outline-item';
        div.dataset.blockId = section.block_id;
        div.innerHTML = `
        <div class="flex flex-col gap-2 items-center text-gray-600 pt-1">
          <button class="move-up-btn hover:text-white" title="Omhoog">▲</button>
          <div class="text-xs font-mono sequence-number">${container.children.length + 1}</div>
          <button class="move-down-btn hover:text-white" title="Omlaag">▼</button>
        </div>
        <div class="flex-1 space-y-2">
          <input class="w-full bg-transparent font-semibold text-gray-200 focus:text-white border-b border-transparent focus:border-gray-700 p-0 focus:ring-0 mb-1 section-heading" value="${section.heading}" placeholder="Heading" />
          <textarea class="w-full bg-transparent text-sm text-gray-400 focus:text-gray-300 border-none p-0 focus:ring-0 resize-none section-summary" rows="2" placeholder="Wat moet hier besproken worden?">${section.summary}</textarea>
        </div>
        <div class="flex flex-col items-end justify-between">
          <button class="remove-section-btn text-gray-700 hover:text-red-500 transition-colors" title="Verwijder">✕</button>
          <span class="text-[10px] uppercase font-mono text-gray-800 bg-gray-900 px-1.5 py-0.5 rounded border border-gray-800">${section.block_id}</span>
        </div>
      `;
        container.appendChild(div);
        attachOutlineEventListeners(div);
    }

    function attachOutlineEventListeners(el) {
        el.querySelector('.move-up-btn').addEventListener('click', () => swapNodes(el, 'up'));
        el.querySelector('.move-down-btn').addEventListener('click', () => swapNodes(el, 'down'));
        el.querySelector('.remove-section-btn').addEventListener('click', () => {
            el.remove();
            updateSequenceNumbers();
        });
    }

    function swapNodes(node, direction) {
        const container = document.getElementById('outline-sections');
        if (direction === 'up') {
            if (node.previousElementSibling) {
                container.insertBefore(node, node.previousElementSibling);
            }
        } else {
            if (node.nextElementSibling) {
                container.insertBefore(node.nextElementSibling, node);
            }
        }
        updateSequenceNumbers();
    }

    function updateSequenceNumbers() {
        const items = document.querySelectorAll('.outline-item');
        items.forEach((item, idx) => {
            item.querySelector('.sequence-number').innerText = idx + 1;
        });
    }

    const addSectionBtn = document.getElementById('add-section-btn');
    if (addSectionBtn) {
        addSectionBtn.addEventListener('click', () => {
            appendSection({
                heading: 'Nieuwe Sectie',
                summary: 'Beschrijf de inhoud...',
                block_id: 'custom_' + Math.random().toString(36).substring(7)
            });
            updateSequenceNumbers();
        });
    }

    // --- Step 2: Start Writing ---
    const startWritingBtn = document.getElementById('start-writing-btn');
    if (startWritingBtn) {
        startWritingBtn.addEventListener('click', async () => {
            // Sync DOM back to state.outline
            const items = document.querySelectorAll('.outline-item');
            state.outline.sections = Array.from(items).map(item => ({
                heading: item.querySelector('.section-heading').value,
                summary: item.querySelector('.section-summary').value,
                block_id: item.dataset.blockId,
                level: 'h2' // default
            }));
            state.outline.seo_title = document.getElementById('seo_title').value;
            state.outline.slug = document.getElementById('slug').value;

            setStep(3);
            await generateAllBlocks();
        });
    }

    async function generateAllBlocks() {
        const container = document.getElementById('live-preview');
        const progressBar = document.getElementById('progress-bar');
        const progressText = document.getElementById('progress-text');

        container.innerHTML = '';
        state.generatedBlocks = [];
        const sections = state.outline.sections;
        const total = sections.length;

        for (let i = 0; i < total; i++) {
            const section = sections[i];

            // Create placeholder
            const placeholder = document.createElement('div');
            placeholder.className = 'p-6 bg-gray-900/50 rounded-xl border border-gray-800 animate-pulse';
            placeholder.innerHTML = `<div class="h-4 bg-gray-800 rounded w-1/3 mb-4"></div><div class="space-y-2"><div class="h-3 bg-gray-800 rounded w-full"></div><div class="h-3 bg-gray-800 rounded w-5/6"></div></div>`;
            container.appendChild(placeholder);

            // Scroll to bottom
            window.scrollTo(0, document.body.scrollHeight);

            try {
                // API Call
                const res = await fetch('/api/generate/block', {
                    method: 'POST',
                    body: JSON.stringify({
                        block_id: section.block_id,
                        block_label: section.heading,
                        block_description: section.summary,
                        outline: state.outline,
                        platforms: state.config.platforms,
                        previous_blocks: state.generatedBlocks.map(b => ({ block_id: b.block_id, content: b.content })),
                        tone: state.config.tone,
                        target_keyword: state.config.target_keyword,
                        model_provider: state.config.model_provider
                    })
                });

                const blockData = await res.json();

                // Replace placeholder with real content
                placeholder.className = 'article-block prose prose-invert max-w-none p-6 bg-transparent border-b border-gray-800/50 last:border-0';
                placeholder.innerHTML = `
            <h3 class="text-xl font-bold text-white mb-4">${blockData.heading}</h3>
            <div class="whitespace-pre-wrap text-gray-300">${blockData.content}</div>
          `;
                placeholder.classList.remove('animate-pulse');

                state.generatedBlocks.push(blockData);

                // Update progress
                const pct = Math.round(((i + 1) / total) * 100);
                progressBar.style.width = pct + '%';
                progressText.innerText = pct + '%';

            } catch (err) {
                console.error(err);
                placeholder.innerHTML = `<div class="text-red-500">Error generating block: ${err.message}</div>`;
            }
        }

        // Finish
        const finishControls = document.getElementById('finish-writing-controls');
        if (finishControls) finishControls.classList.remove('hidden');
    }

    // --- Navigation Handlers ---
    document.querySelectorAll('.back-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (state.step > 1) setStep(state.step - 1);
        });
    });

    const toReviewBtn = document.getElementById('to-review-btn');
    if (toReviewBtn) {
        toReviewBtn.addEventListener('click', () => {
            // Fill review data
            const previewTitle = document.getElementById('final-title');
            if (previewTitle) previewTitle.innerText = state.outline.title;

            const previewDesc = document.getElementById('final-description');
            if (previewDesc) previewDesc.innerText = state.outline.meta_description;

            const totalWords = state.generatedBlocks.reduce((acc, b) => acc + b.content.split(/\s+/).length, 0);

            const wordCount = document.getElementById('final-wordcount');
            if (wordCount) wordCount.innerText = totalWords + ' woorden';

            const readTime = document.getElementById('final-readingtime');
            if (readTime) readTime.innerText = Math.ceil(totalWords / 200) + ' min leestijd';

            setStep(4);
        });
    }

    const saveDraftBtn = document.getElementById('save-draft-btn');
    if (saveDraftBtn) {
        saveDraftBtn.addEventListener('click', () => {
            alert('Draft saving logic here');
        });
    }

    const publishBtn = document.getElementById('publish-btn');
    if (publishBtn) {
        publishBtn.addEventListener('click', async () => {
            const btn = document.getElementById('publish-btn');
            btn.disabled = true;
            btn.innerText = existingArticle ? 'Bezig met updaten...' : 'Bezig met opslaan...';

            try {
                // Step 1: Generate hero image if enabled
                let heroImage = existingArticle?.heroImage || `https://placehold.co/1200x630/111827/EAB308?text=${encodeURIComponent(state.outline.title.substring(0, 40))}`;

                if (state.config.generate_hero_image) {
                    btn.innerText = '🎨 Afbeelding genereren...';
                    const statusEl = document.getElementById('hero-image-status');
                    if (statusEl) statusEl.innerText = 'AI genereert je hero afbeelding...';

                    try {
                        const imgRes = await fetch('/api/generate/image', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                title: state.outline.title,
                                keyword: state.config.target_keyword || state.outline.title,
                                slug: state.outline.slug,
                                provider: state.config.image_provider,
                                style: state.config.image_style,
                            })
                        });
                        const imgData = await imgRes.json();
                        if (imgData.success && imgData.url) {
                            heroImage = imgData.url;
                            // Show preview
                            const previewEl = document.getElementById('hero-image-preview');
                            if (previewEl) {
                                previewEl.innerHTML = `<img src="${imgData.url}" alt="Hero" class="rounded-lg max-h-[300px] object-cover w-full" />`;
                            }
                        } else {
                            console.warn('Image generation failed:', imgData.error);
                            if (statusEl) statusEl.innerText = '⚠️ Afbeelding gefaald, oude/placeholder gebruikt.';
                        }
                    } catch (imgErr) {
                        console.warn('Image generation error:', imgErr);
                    }
                }

                btn.innerText = existingArticle ? '📝 Artikel updaten...' : '📝 Artikel opslaan...';

                // Step 2: Save the article
                const payload = {
                    title: state.outline.title,
                    description: state.outline.meta_description,
                    slug: state.outline.slug,
                    heroImage,
                    pubDate: existingArticle?.pubDate || new Date().toISOString(),
                    target_keyword: state.config.target_keyword,
                    seo_title: state.outline.seo_title,
                    article_type: state.config.article_type,
                    blocks: state.generatedBlocks,
                    platforms: state.config.platforms,
                    status: existingArticle?.status || 'published' // Keep existing status or default to published
                };

                const method = existingArticle ? 'PUT' : 'POST';
                const url = existingArticle ? `/api/articles/${existingArticle.slug}` : '/api/articles';

                const res = await fetch(url, {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (res.ok) {
                    window.location.href = '/dashboard?success=saved';
                } else {
                    const errData = await res.json();
                    throw new Error(errData.error || 'Save failed');
                }
            } catch (err) {
                alert('Fout bij opslaan: ' + err.message);
                btn.disabled = false;
                btn.innerText = existingArticle ? 'UPDATEN' : 'PUBLICEREN';
            }
        });
    }

    // --- AI Model Selector Toggle ---
    document.querySelectorAll('input[name="model_provider"]').forEach(radio => {
        radio.addEventListener('change', () => {
            const openaiLabel = document.getElementById('model-openai-label');
            const geminiLabel = document.getElementById('model-gemini-label');
            if (!openaiLabel || !geminiLabel) return;

            if (radio.value === 'openai') {
                openaiLabel.classList.add('border-yellow-500', 'bg-yellow-500/10');
                openaiLabel.classList.remove('border-gray-700', 'bg-gray-950');
                openaiLabel.querySelector('.font-semibold').classList.add('text-yellow-400');
                openaiLabel.querySelector('.font-semibold').classList.remove('text-gray-300');
                geminiLabel.classList.remove('border-yellow-500', 'bg-yellow-500/10');
                geminiLabel.classList.add('border-gray-700', 'bg-gray-950');
                geminiLabel.querySelector('.font-semibold').classList.remove('text-yellow-400');
                geminiLabel.querySelector('.font-semibold').classList.add('text-gray-300');
            } else {
                geminiLabel.classList.add('border-yellow-500', 'bg-yellow-500/10');
                geminiLabel.classList.remove('border-gray-700', 'bg-gray-950');
                geminiLabel.querySelector('.font-semibold').classList.add('text-yellow-400');
                geminiLabel.querySelector('.font-semibold').classList.remove('text-gray-300');
                openaiLabel.classList.remove('border-yellow-500', 'bg-yellow-500/10');
                openaiLabel.classList.add('border-gray-700', 'bg-gray-950');
                openaiLabel.querySelector('.font-semibold').classList.remove('text-yellow-400');
                openaiLabel.querySelector('.font-semibold').classList.add('text-gray-300');
            }
        });
    });

    // --- Hero Image Toggle ---
    const genHeroImg = document.getElementById('generate_hero_image');
    if (genHeroImg) {
        genHeroImg.addEventListener('change', (e) => {
            const imageConfig = document.getElementById('image-config');
            if (imageConfig) {
                imageConfig.style.opacity = e.target.checked ? '1' : '0.4';
                imageConfig.style.pointerEvents = e.target.checked ? 'auto' : 'none';
            }
        });
    }

    // --- Platform Management ---
    const platformModal = document.getElementById('platform-modal');
    const platformForm = document.getElementById('platform-form');
    const platformList = document.getElementById('platform-list');
    const addPlatformBtn = document.getElementById('add-platform-btn');

    if (addPlatformBtn && platformModal && platformForm) {
        addPlatformBtn.addEventListener('click', () => {
            document.getElementById('modal-title').innerText = 'Nieuw Platform Toevoegen';
            document.getElementById('modal-submit-btn').innerText = 'Toevoegen';
            document.getElementById('platform-id-input').value = '';
            platformForm.reset();
            platformModal.showModal();
        });
    }

    // Delegate Edit/Delete clicks
    if (platformList) {
        platformList.addEventListener('click', (e) => {
            const editBtn = e.target.closest('.edit-platform-btn');
            const deleteBtn = e.target.closest('.delete-platform-btn');

            if (editBtn) {
                const platform = JSON.parse(editBtn.dataset.platform);
                document.getElementById('modal-title').innerText = `Bewerk ${platform.name}`;
                document.getElementById('modal-submit-btn').innerText = 'Opslaan';
                document.getElementById('platform-id-input').value = platform.id;
                document.getElementById('platform-name-input').value = platform.name;
                document.getElementById('platform-slug-input').value = platform.slug;
                document.getElementById('platform-link-input').value = platform.affiliateLink || '';
                platformModal.showModal();
            }

            if (deleteBtn) {
                if (confirm('Weet je zeker dat je dit platform wilt verwijderen?')) {
                    const id = deleteBtn.dataset.id;
                    deletePlatform(id);
                }
            }
        });
    }

    async function deletePlatform(id) {
        try {
            const res = await fetch('/api/platforms', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id })
            });
            if (res.ok) {
                const el = document.querySelector(`[data-platform-id="${id}"]`);
                if (el) el.remove();
            }
        } catch (err) {
            alert('Fout bij verwijderen: ' + err.message);
        }
    }

    if (platformForm) {
        platformForm.addEventListener('submit', async (e) => {
            if (e.submitter.value === 'cancel') return;
            e.preventDefault();

            const formData = new FormData(platformForm);
            const data = Object.fromEntries(formData.entries());
            const isEdit = !!data.id;

            try {
                const res = await fetch('/api/platforms', {
                    method: isEdit ? 'PATCH' : 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });

                if (!res.ok) throw new Error('Failed to save platform');

                // Fast path: just refresh the page for platform updates to keep it simple and sync data-attributes
                window.location.reload();

            } catch (err) {
                alert('Error: ' + err.message);
            }
        });
    }
});
