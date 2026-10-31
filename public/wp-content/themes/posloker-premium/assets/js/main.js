(function () {
	'use strict';

	const header = document.querySelector('[data-header]');
	const menuToggle = document.querySelector('.menu-toggle');
	const menu = document.querySelector('.main-nav');

	if (menuToggle && menu) {
		menuToggle.addEventListener('click', function () {
			const open = menu.classList.toggle('is-open');
			document.body.classList.toggle('menu-open', open);
			menuToggle.setAttribute('aria-expanded', String(open));
		});
		menu.addEventListener('click', function (event) {
			if (event.target.closest('a')) {
				menu.classList.remove('is-open');
				document.body.classList.remove('menu-open');
				menuToggle.setAttribute('aria-expanded', 'false');
			}
		});
	}

	if (header) {
		let headerOffset = header.offsetTop + 90;
		window.addEventListener('scroll', function () {
			header.classList.toggle('is-sticky', window.scrollY > headerOffset);
		}, { passive: true });
	}

	const serviceCards = document.querySelectorAll('[data-service-card]');
	if (serviceCards.length) {
		const selectService = function (selectedCard) {
			serviceCards.forEach(function (card) {
				const selected = card === selectedCard;
				card.classList.toggle('is-selected', selected);
				card.setAttribute('aria-pressed', String(selected));
			});
		};
		serviceCards.forEach(function (card) {
			card.addEventListener('click', function () {
				selectService(card);
			});
			card.addEventListener('keydown', function (event) {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					selectService(card);
				}
			});
		});
	}

	const calculator = document.querySelector('[data-calculator]');
	if (calculator) {
		const city = calculator.querySelector('[data-city]');
		const citySearch = calculator.querySelector('[data-city-search]');
		const citySearchHelp = calculator.querySelector('[data-city-search-help]');
		const cityResults = calculator.querySelector('[data-city-results]');
		const packageList = calculator.querySelector('[data-package-list]');
		const totalNode = calculator.querySelector('[data-total]');
		const orderButton = calculator.querySelector('[data-order-button]');
		const cityCoach = calculator.querySelector('[data-city-coach]');
		const cityCoachOpen = calculator.querySelector('[data-city-coach-open]');
		const cityCoachClose = calculator.querySelector('[data-city-coach-close]');
		const formatRupiah = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
		const pricing = poslokerData.pricing || {};
		Object.keys(pricing).forEach(function (cityRule) {
			(pricing[cityRule] || []).forEach(function (item) {
				if (!Array.isArray(item.features)) item.features = [];
				if (!item.features.includes('Instagram Carousel hingga 10 slide')) {
					item.features.push('Instagram Carousel hingga 10 slide');
				}
			});
		});
		const setCityCoach = function (open, remember) {
			if (!cityCoach || !cityCoachOpen) return;
			cityCoach.hidden = !open;
			cityCoachOpen.setAttribute('aria-expanded', String(open));
			if (!open && remember) {
				try { sessionStorage.setItem('posloker_city_tip_seen_v2', '1'); } catch (error) { /* Storage can be unavailable. */ }
			}
		};
		if (cityCoach && cityCoachOpen) {
			cityCoachOpen.addEventListener('click', function () { setCityCoach(cityCoach.hidden, false); });
			if (cityCoachClose) cityCoachClose.addEventListener('click', function () { setCityCoach(false, true); citySearch.focus(); });
			document.addEventListener('keydown', function (event) {
				if (event.key === 'Escape' && !cityCoach.hidden) setCityCoach(false, true);
			});
			let tipSeen = false;
			try { tipSeen = sessionStorage.getItem('posloker_city_tip_seen_v2') === '1'; } catch (error) { tipSeen = false; }
			if (!tipSeen) {
				// Render from page load so mobile browsers do not depend on scroll observers.
				setCityCoach(true, false);
			}
		}
		const escapeHtml = function (value) {
			return String(value).replace(/[&<>"']/g, function (character) {
				return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character];
			});
		};

		const selectedPackages = function () {
			const selectedCity = city.options[city.selectedIndex];
			if (!selectedCity || !selectedCity.value) return [];
			return pricing[selectedCity.dataset.rule] || pricing.default || [];
		};

		const updateOrder = function () {
			const selected = calculator.querySelector('input[name="city-package"]:checked');
			if (!selected) return;
			const packages = selectedPackages();
			const item = packages.find(function (entry) { return entry.id === selected.value; }) || packages[0];
			if (!item) return;

			totalNode.textContent = formatRupiah.format(Number(item.price)).replace(/\s/g, '');
			const orderUrl = new URL(poslokerData.paymentUrl, window.location.origin);
			orderUrl.searchParams.set('city', city.value);
			orderUrl.searchParams.set('package', item.id);
			orderButton.href = orderUrl.toString();
			orderButton.classList.remove('is-disabled');
			orderButton.setAttribute('aria-disabled', 'false');
			calculator.dispatchEvent(new CustomEvent('posloker:package-selected', { detail: { city: city.value, package: item } }));
		};

		const renderPackages = function () {
			const packages = selectedPackages();
			if (!city.value || !packages.length) {
				packageList.innerHTML = '<div class="package-empty">Ketik dan pilih kota lokasi untuk melihat paket.</div>';
				totalNode.textContent = '—';
				orderButton.href = '#';
				orderButton.textContent = 'Pilih Kota Terlebih Dahulu →';
				orderButton.classList.add('is-disabled');
				orderButton.setAttribute('aria-disabled', 'true');
				return;
			}
			packageList.innerHTML = packages.map(function (item, index) {
				const features = item.features.map(function (feature) { return '<li>' + escapeHtml(feature) + '</li>'; }).join('');
				const badge = item.badge ? '<small>' + escapeHtml(item.badge) + '</small>' : '';
				return '<label class="package-option">' +
					'<input type="radio" name="city-package" value="' + escapeHtml(item.id) + '"' + (index === 0 ? ' checked' : '') + '>' +
					'<span class="package-option__main"><b>' + escapeHtml(item.name) + '</b>' + badge + '<ul>' + features + '</ul></span>' +
					'<strong>' + formatRupiah.format(Number(item.price)).replace(/\s/g, '') + '</strong>' +
				'</label>';
			}).join('');
			orderButton.textContent = 'Order Sekarang →';
			updateOrder();
		};

		const closeCityResults = function () {
			cityResults.hidden = true;
			citySearch.setAttribute('aria-expanded', 'false');
		};

		const chooseCity = function (option) {
			city.value = option.value;
			citySearch.value = option.value;
			citySearch.classList.remove('is-invalid');
			citySearchHelp.textContent = 'Paket untuk ' + option.value + ' ditampilkan di bawah.';
			closeCityResults();
			renderPackages();
		};

		city.addEventListener('change', function () {
			renderPackages();
		});
		citySearch.addEventListener('input', function () {
			const typedValue = citySearch.value.trim().toLowerCase();
			orderButton.classList.add('is-disabled');
			orderButton.setAttribute('aria-disabled', 'true');

			if (typedValue.length < 2) {
				citySearch.classList.remove('is-invalid');
				citySearchHelp.textContent = typedValue ? 'Ketik minimal 2 huruf.' : 'Ketik nama kota lokasi, lalu pilih dari hasil pencarian.';
				closeCityResults();
				return;
			}

			const matches = Array.from(city.options).filter(function (option) {
				return option.value && option.textContent.toLowerCase().includes(typedValue);
			}).slice(0, 6);

			citySearch.classList.toggle('is-invalid', matches.length === 0);
			citySearchHelp.textContent = matches.length ? 'Pilih kota dari hasil berikut.' : 'Kota tidak ditemukan. Coba kata kunci lain.';
			cityResults.innerHTML = matches.length ? matches.map(function (option) {
				const parts = option.textContent.split('—');
				return '<button type="button" role="option" data-city-choice="' + escapeHtml(option.value) + '">' +
					'<strong>' + escapeHtml(parts[0].trim()) + '</strong>' +
					'<small>' + escapeHtml(parts[1] ? parts[1].trim() : '') + '</small>' +
				'</button>';
			}).join('') : '<span class="no-city-result">Tidak ada hasil untuk “' + escapeHtml(citySearch.value.trim()) + '”.</span>';
			cityResults.hidden = false;
			citySearch.setAttribute('aria-expanded', 'true');
		});
		cityResults.addEventListener('click', function (event) {
			const choice = event.target.closest('[data-city-choice]');
			if (!choice) return;
			const option = Array.from(city.options).find(function (item) {
				return item.value === choice.dataset.cityChoice;
			});
			if (option) chooseCity(option);
		});
		citySearch.addEventListener('keydown', function (event) {
			if (event.key === 'Escape') closeCityResults();
			if (event.key === 'Enter' && !cityResults.hidden) {
				const firstChoice = cityResults.querySelector('[data-city-choice]');
				if (firstChoice) {
					event.preventDefault();
					firstChoice.click();
				}
			}
		});
		citySearch.addEventListener('focus', function () {
			citySearch.select();
		});
		document.addEventListener('click', function (event) {
			if (!event.target.closest('.city-search-label')) closeCityResults();
		});
		packageList.addEventListener('change', updateOrder);
		// Tetap aman saat cache server masih menyajikan markup tema versi lama
		// yang belum memiliki pilihan kota kosong.
		if (!Array.from(city.options).some(function (option) { return option.value === ''; })) {
			const emptyOption = document.createElement('option');
			emptyOption.value = '';
			emptyOption.textContent = 'Pilih kota lokasi';
			emptyOption.dataset.rule = '';
			city.insertBefore(emptyOption, city.firstChild);
		}
		const requestedCity = new URLSearchParams(window.location.search).get('kota');
		if (requestedCity) {
			const matchingOption = Array.from(city.options).find(function (option) { return option.value === requestedCity; });
			if (matchingOption) city.value = requestedCity;
		} else city.value = '';
		citySearch.value = city.value || '';
		renderPackages();
	}

	const search = document.querySelector('[data-location-search]');
	const grid = document.querySelector('[data-location-grid]');
	const filters = document.querySelector('[data-location-filters]');
	const empty = document.querySelector('[data-location-empty]');
	let activeRegion = 'all';

	const filterLocations = function () {
		if (!grid) return;
		const term = search ? search.value.toLowerCase().trim() : '';
		let visible = 0;
		grid.querySelectorAll('.location-card').forEach(function (card) {
			const matchesTerm = !term || card.dataset.search.includes(term);
			const matchesRegion = activeRegion === 'all' || card.dataset.region === activeRegion;
			card.hidden = !(matchesTerm && matchesRegion);
			if (!card.hidden) visible++;
		});
		if (empty) empty.hidden = visible > 0;
	};

	if (search) search.addEventListener('input', filterLocations);
	if (filters) {
		filters.addEventListener('click', function (event) {
			const button = event.target.closest('button');
			if (!button) return;
			activeRegion = button.dataset.region;
			filters.querySelectorAll('button').forEach(function (item) { item.classList.remove('active'); });
			button.classList.add('active');
			filterLocations();
		});
	}
})();
