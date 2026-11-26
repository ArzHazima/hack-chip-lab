// Invented test fixture
load WriteOnceRAM8.hdl,
output-file WriteOnceRAM8.out,
compare-to WriteOnceRAM8.cmp,
output-list time%S1.4.1 in%D1.6.1 load%B1.1.1 address%D1.1.1 out%D1.6.1 valid%B1.1.1;

set in 100, set load 1, set address 2, tick, output; tock, output;
set in 200, tick, output; tock, output;
set address 3, set in 7, tick, output; tock, output;
set load 0, set address 2, eval, output;
set address 4, eval, output;
