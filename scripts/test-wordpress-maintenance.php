<?php
define( 'ABSPATH', __DIR__ );
$hooks = array();
function add_action( $hook, $callback, $priority ) { $GLOBALS['hooks'][] = array( $hook, $callback, $priority ); }
require __DIR__ . '/../migration/wordpress-maintenance.php';
$checks = 0;
function check( $value, $description ) {
	$GLOBALS['checks']++;
	if ( ! $value ) { throw new Exception( $description ); }
}
$class = 'PosLoker_Scheduled_Maintenance_20261102';
check( strtotime( '2026-11-02T00:00:00Z' ) === $class::START_UTC, 'Start timestamp' );
check( strtotime( '2026-11-02T01:00:00Z' ) === $class::END_UTC, 'End timestamp' );
check( ! $class::active_at( $class::START_UTC - 1 ), 'Before start' );
check( $class::active_at( $class::START_UTC ), 'Exact start inclusive' );
check( $class::active_at( $class::END_UTC - 1 ), 'Last second included' );
check( ! $class::active_at( $class::END_UTC ), 'Exact end exclusive' );
foreach ( array( 'posloker.my.id', 'www.posloker.my.id', 'POSLOKER.MY.ID', 'posloker.my.id:443' ) as $host ) {
	check( $class::target_host( $host ), 'Target host' );
}
foreach ( array( 'new.yudhi7208.workers.dev', 'evilposloker.my.id', 'posloker.my.id.example.com', 'posloker.my.id@evil.com', '' ) as $host ) {
	check( ! $class::target_host( $host ), 'Other host untouched' );
}
$now = $class::START_UTC + 1;
check( $class::must_block( $now, 'posloker.my.id', '/index.php', false, false, false, false ), 'Public frontend blocked' );
check( $class::must_block( $now, 'posloker.my.id', '/index.php', false, true, false, false ), 'Owner frontend maintenance too' );
check( $class::must_block( $now, 'posloker.my.id', '/wp-admin/admin-post.php', true, true, false, false ), 'Owner payment submit blocked' );
check( $class::must_block( $now, 'posloker.my.id', '/wp-admin/admin-post.php', true, false, false, false ), 'Public payment submit blocked' );
check( $class::must_block( $now, 'posloker.my.id', '/index.php', false, false, false, false ), 'REST blocked' );
check( $class::must_block( $now, 'posloker.my.id', '/wp-admin/admin-ajax.php', true, false, false, false ), 'Public AJAX blocked' );
check( ! $class::must_block( $now, 'posloker.my.id', '/wp-admin/index.php', true, true, false, false ), 'Owner dashboard allowed' );
check( ! $class::must_block( $now, 'posloker.my.id', '/wp-admin/export.php', true, true, false, false ), 'Owner export allowed' );
check( ! $class::must_block( $now, 'posloker.my.id', '/wp-login.php', false, false, false, false ), 'Login available' );
check( ! $class::must_block( $now, 'posloker.my.id', '/index.php', false, false, true, false ), 'CLI unaffected' );
check( ! $class::must_block( $now, 'posloker.my.id', '/wp-cron.php', false, false, false, true ), 'Cron unaffected' );
check( ! $class::must_block( $class::END_UTC, 'posloker.my.id', '/index.php', false, false, false, false ), 'Automatically ends' );
check( ! $class::must_block( $now, 'new.yudhi7208.workers.dev', '/index.php', false, false, false, false ), 'Cloudflare untouched' );
check( count( $hooks ) === 1 && $hooks[0][0] === 'init' && $hooks[0][2] === -9999, 'Early registered maintenance guard' );
echo json_encode( array( 'passed' => $checks, 'status' => 'PASS' ) ), "\n";
