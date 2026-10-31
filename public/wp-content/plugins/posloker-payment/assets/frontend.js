( function () {
	'use strict';

	var config = window.poslokerPayment || {};
	var pricing = config.pricing || {};
	var rupiah = new Intl.NumberFormat( 'id-ID', {
		style: 'currency',
		currency: 'IDR',
		maximumFractionDigits: 0
	} );

	function slug( value ) {
		return String( value || '' ).normalize( 'NFD' ).replace( /[\u0300-\u036f]/g, '' ).toLowerCase().replace( /[^a-z0-9]+/g, '-' ).replace( /^-|-$/g, '' );
	}

	function packagesFor( city ) {
		return pricing[ slug( city ) ] || pricing.default || [];
	}

	function checkoutUrl( city, packageId ) {
		var url = new URL( config.checkoutUrl, window.location.origin );
		url.searchParams.set( 'city', city );
		url.searchParams.set( 'package', packageId );
		return url.toString();
	}

	function connectThemeCalculator() {
		var calculator = document.querySelector( '[data-calculator]' );
		if ( ! calculator ) {
			return;
		}
		var button = calculator.querySelector( '[data-order-button]' );
		var city = calculator.querySelector( '[data-city]' );

		function applySelection( selectedCity, selectedPackage ) {
			if ( ! button || ! selectedCity || ! selectedPackage || ! selectedPackage.id ) {
				return;
			}
			button.href = checkoutUrl( selectedCity, selectedPackage.id );
			button.removeAttribute( 'target' );
			button.removeAttribute( 'rel' );
		}

		calculator.addEventListener( 'posloker:package-selected', function ( event ) {
			applySelection( event.detail.city, event.detail.package );
		} );

		function syncCurrent() {
			var selected = calculator.querySelector( 'input[name="city-package"]:checked' );
			if ( ! city || ! selected ) {
				return;
			}
			var item = packagesFor( city.value ).find( function ( entry ) {
				return entry.id === selected.value;
			} );
			applySelection( city.value, item );
		}
		calculator.addEventListener( 'change', function () {
			window.setTimeout( syncCurrent, 0 );
		} );
		window.setTimeout( syncCurrent, 50 );
	}

	function connectCityPackageCards() {
		if ( ! config.currentCity ) {
			return;
		}
		var packages = packagesFor( config.currentCity );
		document.querySelectorAll( '.city-package-card' ).forEach( function ( card ) {
			var heading = card.querySelector( 'h3' );
			var link = card.querySelector( 'a.button' );
			if ( ! heading || ! link ) {
				return;
			}
			var item = packages.find( function ( entry ) {
				return entry.name.trim().toLowerCase() === heading.textContent.trim().toLowerCase();
			} );
			if ( item ) {
				link.href = checkoutUrl( config.currentCity, item.id );
				link.removeAttribute( 'target' );
				link.removeAttribute( 'rel' );
			}
		} );
	}

	function connectPaymentForm() {
		var form = document.querySelector( '[data-payment-form]' );
		if ( ! form ) {
			return;
		}
		var city = form.querySelector( '[data-payment-city]' );
		var packageSelect = form.querySelector( '[data-payment-package]' );
		var total = form.querySelector( '[data-payment-total]' );
		var uniqueCode = Number( form.querySelector( '[data-unique-code]' ).value || 0 );
		var proof = form.querySelector( '[data-payment-proof]' );
		var proofLabel = form.querySelector( '[data-proof-label]' );
		var adMaterial = form.querySelector( '[data-ad-material]' );
		var adMaterialLabel = form.querySelector( '[data-ad-material-label]' );
		var reel = form.querySelector( '[data-reel-video]' );
		var reelSection = form.querySelector( '[data-reel-section]' );
		function validateMaterials() {
			var files = Array.from( adMaterial.files ).concat( reel && ! reel.disabled ? Array.from( reel.files ) : [] );
			var sum = files.reduce( function ( total, file ) { return total + file.size; }, 0 );
			adMaterial.setCustomValidity( files.length > 10 || sum > 10 * 1024 * 1024 ? 'Video dan materi maksimal 10 file dengan total 10 MB.' : '' );
		}
		if ( reel ) {
			reel.addEventListener( 'change', function () {
				form.querySelector( '[data-reel-label]' ).textContent = reel.files.length ? reel.files[0].name : 'Upload video Reel (MP4)';
				validateMaterials();
				adMaterial.reportValidity();
			} );
		}
		var confirmCity = document.querySelector( '[data-confirm-city]' );
		var confirmPackage = document.querySelector( '[data-confirm-package]' );
		var confirmTotal = document.querySelector( '[data-confirm-total]' );

		function updateTotal() {
			if ( reelSection && reel ) {
				var isPlus = packageSelect.value === 'komplit-plus';
				reelSection.hidden = ! isPlus;
				reel.disabled = ! isPlus;
				if ( ! isPlus ) { reel.value = ''; }
				validateMaterials();
			}
			var item = packagesFor( city.value ).find( function ( entry ) {
				return entry.id === packageSelect.value;
			} );
			if ( item ) {
				var free = Number( item.price ) === 0;
				if ( free !== ( form.dataset.freeOrder === '1' ) ) {
					var next = new URL( config.confirmationUrl, window.location.origin );
					next.searchParams.set( 'city', city.value ); next.searchParams.set( 'package', item.id );
					window.location.assign( next.toString() ); return;
				}
				var amount = free ? 0 : Number( item.price ) + uniqueCode;
				total.textContent = rupiah.format( amount ).replace( /\s/g, '' );
				if ( confirmCity ) {
					confirmCity.textContent = city.value;
				}
				if ( confirmPackage ) {
					confirmPackage.textContent = item.name;
				}
				if ( confirmTotal ) {
					confirmTotal.textContent = rupiah.format( amount ).replace( /\s/g, '' );
				}
			}
		}

		city.addEventListener( 'change', function () {
			var packages = packagesFor( city.value );
			packageSelect.innerHTML = packages.map( function ( item ) {
				var option = document.createElement( 'option' );
				option.value = item.id;
				option.textContent = item.name;
				return option.outerHTML;
			} ).join( '' );
			updateTotal();
		} );
		packageSelect.addEventListener( 'change', updateTotal );
		proof.addEventListener( 'change', function () {
			proofLabel.textContent = proof.files.length ? proof.files[0].name : 'Pilih bukti transfer';
		} );
		if ( adMaterial && adMaterialLabel ) {
			adMaterial.addEventListener( 'change', function () {
				var files = Array.from( adMaterial.files );
				var total = files.reduce( function ( sum, file ) { return sum + file.size; }, 0 );
				adMaterial.setCustomValidity( files.length > 10 || total > 10 * 1024 * 1024 ? 'Maksimal 10 file dengan total ukuran 10 MB.' : '' );
				adMaterialLabel.textContent = files.length ? files.length + ' file · ' + ( total / 1024 / 1024 ).toFixed( 2 ) + ' MB — ' + files.map( function ( file ) { return file.name; } ).join( ', ' ) : 'Upload materi iklan loker (jika ada)';
				adMaterial.reportValidity();
			} );
			adMaterial.addEventListener( 'change', validateMaterials );
		}
	}

	function connectPaymentPopup() {
		var choice = document.querySelector( '[data-payment-choice]' );
		var modal = document.querySelector( '[data-payment-modal]' );
		if ( ! choice || ! modal ) {
			return;
		}
		var city = choice.querySelector( '[data-popup-city]' );
		var packageSelect = choice.querySelector( '[data-popup-package]' );
		var total = choice.querySelector( '[data-popup-total]' );
		var modalTotal = modal.querySelector( '[data-modal-total]' );
		var confirmationLink = modal.querySelector( '[data-confirmation-link]' );
		var paymentCoach = modal.querySelector( '[data-payment-coach]' );
		var paymentCoachOpen = modal.querySelector( '[data-payment-coach-open]' );
		var paymentCoachClose = modal.querySelector( '[data-payment-coach-close]' );
		var openButton = choice.querySelector( '[data-open-payment]' );
		var medanNetworkNote = modal.querySelector( '[data-medan-network-note]' );
		var closeButtons = modal.querySelectorAll( '[data-close-payment]' );
		var uniqueCode = Number( choice.dataset.uniqueCode || 0 );

		function selectedPackage() {
			return packagesFor( city.value ).find( function ( entry ) {
				return entry.id === packageSelect.value;
			} );
		}

		function updateChoice() {
			var item = selectedPackage();
			if ( ! item ) {
				return;
			}
			var amount = rupiah.format( Number( item.price ) === 0 ? 0 : Number( item.price ) + uniqueCode ).replace( /\s/g, '' );
			openButton.textContent = Number( item.price ) === 0 ? 'Kirim Materi Gratis →' : 'Lihat Informasi Pembayaran →';
			total.textContent = amount;
			modalTotal.textContent = amount;
            var reviewCity = modal.querySelector( '[data-review-city]' );
            var reviewPackage = modal.querySelector( '[data-review-package]' );
            var reviewFeatures = modal.querySelector( '[data-review-features]' );
            if ( reviewCity ) reviewCity.textContent = city.value;
            if ( reviewPackage ) reviewPackage.textContent = item.name;
            var reviewPrice = modal.querySelector( '[data-review-price]' );
            var reviewTotal = modal.querySelector( '[data-review-total]' );
            if ( reviewPrice ) reviewPrice.textContent = rupiah.format( Number( item.price ) ).replace( /\s/g, '' );
            if ( reviewTotal ) reviewTotal.textContent = amount;
            if ( reviewFeatures ) {
                reviewFeatures.replaceChildren();
                ( item.features || [] ).forEach( function ( feature ) {
                    var li = document.createElement( 'li' );
                    li.textContent = feature;
                    reviewFeatures.appendChild( li );
                } );
            }
			if ( medanNetworkNote ) {
				medanNetworkNote.hidden = [ 'medan', 'binjai', 'deli serdang', 'lubuk pakam', 'tanjung morawa' ].indexOf( city.value.toLowerCase() ) === -1;
			}
			var url = new URL( config.confirmationUrl, window.location.origin );
			url.searchParams.set( 'city', city.value );
			url.searchParams.set( 'package', item.id );
			url.searchParams.set( 'code', uniqueCode );
			confirmationLink.href = url.toString();
		}

		function rebuildPackages() {
			packageSelect.innerHTML = '';
			packagesFor( city.value ).forEach( function ( item ) {
				var option = document.createElement( 'option' );
				option.value = item.id;
				option.textContent = item.name;
				packageSelect.appendChild( option );
			} );
			updateChoice();
		}

		function openModal() {
			updateChoice();
			var selected = packagesFor( city.value ).find( function ( item ) { return item.id === packageSelect.value; } );
			if ( selected && Number( selected.price ) === 0 ) { window.location.assign( confirmationLink.href ); return; }
			modal.classList.add( 'is-open' );
			modal.setAttribute( 'aria-hidden', 'false' );
			document.body.classList.add( 'plpay-modal-open' );
			var tipSeen = false;
			try { tipSeen = window.sessionStorage.getItem( 'posloker_payment_tip_seen' ) === '1'; } catch ( error ) { tipSeen = false; }
			if ( ! tipSeen ) {
				setPaymentCoach( true, false );
			}
			var dialog = modal.querySelector( '.plpay-modal-dialog' );
			dialog.setAttribute( 'tabindex', '-1' );
			dialog.focus( { preventScroll: true } );
			dialog.scrollTop = 0;
		}

		function setPaymentCoach( open, remember ) {
			if ( ! paymentCoach || ! paymentCoachOpen ) {
				return;
			}
			paymentCoach.hidden = ! open;
			paymentCoachOpen.setAttribute( 'aria-expanded', String( open ) );
			if ( ! open && remember ) {
				try { window.sessionStorage.setItem( 'posloker_payment_tip_seen', '1' ); } catch ( error ) { /* Storage can be unavailable. */ }
			}
		}

		function closeModal() {
			modal.classList.remove( 'is-open' );
			modal.setAttribute( 'aria-hidden', 'true' );
			document.body.classList.remove( 'plpay-modal-open' );
			openButton.focus();
		}

		city.addEventListener( 'change', rebuildPackages );
		packageSelect.addEventListener( 'change', updateChoice );
		openButton.addEventListener( 'click', openModal );
		closeButtons.forEach( function ( button ) {
			button.addEventListener( 'click', closeModal );
		} );
		if ( paymentCoachOpen ) {
			paymentCoachOpen.addEventListener( 'click', function () {
				setPaymentCoach( paymentCoach.hidden, false );
			} );
		}
		if ( paymentCoachClose ) {
			paymentCoachClose.addEventListener( 'click', function () {
				setPaymentCoach( false, true );
				confirmationLink.focus();
			} );
		}
		document.addEventListener( 'keydown', function ( event ) {
			if ( 'Escape' === event.key && paymentCoach && ! paymentCoach.hidden ) {
				setPaymentCoach( false, true );
			} else if ( 'Escape' === event.key && modal.classList.contains( 'is-open' ) ) {
				closeModal();
			}
		} );
		updateChoice();
		if ( modal.dataset.autoOpen ) {
			window.setTimeout( openModal, 250 );
		}
	}

	function fallbackCopyText( text ) {
		var field = document.createElement( 'textarea' );
		field.value = text;
		field.setAttribute( 'readonly', '' );
		field.style.position = 'fixed';
		field.style.opacity = '0';
		document.body.appendChild( field );
		field.select();
		try {
			document.execCommand( 'copy' );
		} catch ( error ) {
			// The visible feedback remains useful when a browser blocks clipboard access.
		}
		field.remove();
	}

	function copyText( text ) {
		fallbackCopyText( text );
	}

	function connectCopyButton() {
		document.querySelectorAll( '[data-copy-account]' ).forEach( function ( button ) {
			var originalAccountIcon = button.innerHTML;
			var value = document.querySelector( '[data-copy-value]' );
			if ( ! value ) return;
			button.addEventListener( 'click', function () {
				button.textContent = 'Tersalin ✓';
				copyText( value.textContent.trim() );
				window.setTimeout( function () { button.innerHTML = originalAccountIcon; }, 1800 );
			} );
		} );
		document.querySelectorAll( '[data-copy-total]' ).forEach( function ( button ) {
			var container = button.closest( '[data-total-copy]' );
			var value = container ? container.querySelector( '[data-copy-total-value]' ) : null;
			if ( ! value ) return;
			var original = button.innerHTML;
			button.addEventListener( 'click', function () {
				button.textContent = 'Tersalin ✓';
				copyText( value.textContent.trim().replace( /[^0-9]/g, '' ) );
				window.setTimeout( function () { button.innerHTML = original; }, 1800 );
			} );
		} );
	}

	function autoOpenWhatsapp() {
		var result = document.querySelector( '[data-auto-whatsapp]' );
		if ( ! result || ! config.autoWhatsapp ) {
			return;
		}
		var target = result.dataset.autoWhatsapp;
		var key = 'posloker-wa-' + target.slice( -40 );
		if ( window.sessionStorage.getItem( key ) ) {
			return;
		}
		window.sessionStorage.setItem( key, '1' );
		window.setTimeout( function () {
			window.location.href = target;
		}, 1800 );
	}

	connectThemeCalculator();
	connectCityPackageCards();
	connectPaymentPopup();
	connectPaymentForm();
	connectCopyButton();
	autoOpenWhatsapp();
}() );
