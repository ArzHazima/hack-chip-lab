// Invented test fixture
load Mirror16.hdl,
output-file Mirror16.out,
compare-to Mirror16.cmp,
output-list in%B1.16.1 out%B1.16.1 out%X1.4.1;

set in %B0000000000000001, eval, output;
set in %B0000000000000011, eval, output;
set in %B0000000011110000, eval, output;
set in %B0001001000110100, eval, output;
set in %B1000000000000001, eval, output;
set in %B1111111111111111, eval, output;
set in %B0000000000000000, eval, output;
