# 
# Usage: To re-create this platform project launch xsct with below options.
# xsct C:\Users\admin\Documents\Projects_SEMES\RFMatcher\SAMBB_v1.01.007\Vitis\MatFW_002\design_1_wrapper\platform.tcl
# 
# OR launch xsct and run below command.
# source C:\Users\admin\Documents\Projects_SEMES\RFMatcher\SAMBB_v1.01.007\Vitis\MatFW_002\design_1_wrapper\platform.tcl
# 
# To create the platform in a different location, modify the -out option of "platform create" command.
# -out option specifies the output directory of the platform project.

platform create -name {design_1_wrapper}\
-hw {C:\Users\admin\Documents\Projects_SEMES\RFMatcher\SAMBB_v1.01.007\Vivado\design_1_wrapper.xsa}\
-out {C:/Users/admin/Documents/Projects_SEMES/RFMatcher/SAMBB_v1.01.007/Vitis/MatFW_002}

platform write
domain create -name {standalone_ps7_cortexa9_0} -display-name {standalone_ps7_cortexa9_0} -os {standalone} -proc {ps7_cortexa9_0} -runtime {cpp} -arch {32-bit} -support-app {empty_application}
platform generate -domains 
platform active {design_1_wrapper}
domain active {zynq_fsbl}
domain active {standalone_ps7_cortexa9_0}
platform generate -quick
platform generate
platform active {design_1_wrapper}
platform config -updatehw {C:/Users/admin/Documents/Projects_SEMES/RFMatcher/SAMBB_v1.01.007/Vivado/design_1_wrapper_revDir.xsa}
platform generate -domains 
platform config -updatehw {C:/Users/admin/Documents/Projects_SEMES/RFMatcher/SAMBB_v1.01.007/Vivado/design_1_wrapper.xsa}
platform generate -domains 
platform config -updatehw {C:/Users/admin/Documents/Projects_SEMES/RFMatcher/SAMBB_v1.01.007/Vivado/design_1_wrapper.xsa}
platform generate -domains 
platform config -updatehw {C:/Users/admin/Documents/Projects_SEMES/RFMatcher/SAMBB_v1.01.007/Vivado/design_1_wrapper.xsa}
platform generate -domains 
platform config -updatehw {C:/Users/admin/Documents/Projects_SEMES/RFMatcher/SAMBB_v1.01.007/Vivado/design_1_wrapper.xsa}
platform generate -domains 
platform generate -domains standalone_ps7_cortexa9_0 
platform generate -domains standalone_ps7_cortexa9_0 
platform generate -domains standalone_ps7_cortexa9_0 
platform clean
platform generate
platform generate -domains standalone_ps7_cortexa9_0,zynq_fsbl 
platform generate -domains standalone_ps7_cortexa9_0,zynq_fsbl 
platform active {design_1_wrapper}
platform config -updatehw {C:/Users/admin/Documents/Projects_SEMES/RFMatcher/SAMBB_v1.01.007/Vivado/design_1_wrapper.xsa}
platform generate -domains 
platform clean
platform generate
platform clean
platform generate
platform config -updatehw {C:/Users/admin/Documents/Projects_SEMES/RFMatcher/SAMBB_v1.01.007/Vivado/design_1_wrapper.xsa}
platform generate -domains 
platform config -updatehw {C:/Users/admin/Documents/Projects_SEMES/RFMatcher/SAMBB_v1.01.007/Vivado/design_1_wrapper.xsa}
platform generate -domains 
platform active {design_1_wrapper}
platform config -updatehw {C:/Users/admin/Documents/Projects_SEMES/RFMatcher/SAMBB_v1.01.007/Vivado/design_1_wrapper.xsa}
platform generate -domains 
platform config -updatehw {C:/Users/admin/Documents/Projects_SEMES/RFMatcher/SAMBB_v1.01.007/Vivado/design_1_wrapper.xsa}
platform generate -domains 
platform config -updatehw {C:/Users/admin/Documents/Projects_SEMES/RFMatcher/SAMBB_v1.01.007/Vivado/design_1_wrapper.xsa}
platform generate -domains 
platform clean
platform generate
platform config -updatehw {C:/Users/admin/Documents/Projects_SEMES/RFMatcher/SAMBB_v1.01.007/Vivado/design_1_wrapper.xsa}
platform config -updatehw {C:/Users/admin/Documents/Projects_SEMES/RFMatcher/SAMBB_v1.01.007/Vivado/design_1_wrapper.xsa}
platform generate -domains 
platform config -updatehw {C:/Users/admin/Documents/Projects_SEMES/RFMatcher/SAMBB_v1.01.007/Vivado/design_1_wrapper.xsa}
platform generate -domains 
platform config -updatehw {C:/Users/admin/Documents/Projects_SEMES/RFMatcher/SAMBB_v1.01.007/Vivado/design_1_wrapper.xsa}
platform generate -domains 
platform config -updatehw {C:/Users/admin/Documents/Projects_SEMES/RFMatcher/SAMBB_v1.01.007/Vivado/design_1_wrapper.xsa}
platform generate -domains 
platform config -updatehw {C:/Users/admin/Documents/Projects_SEMES/RFMatcher/SAMBB_v1.01.007/Vivado/design_1_wrapper.xsa}
platform generate -domains 
platform generate -domains standalone_ps7_cortexa9_0,zynq_fsbl 
platform generate -domains standalone_ps7_cortexa9_0,zynq_fsbl 
platform generate -domains standalone_ps7_cortexa9_0,zynq_fsbl 
platform generate -domains standalone_ps7_cortexa9_0,zynq_fsbl 
platform generate -domains standalone_ps7_cortexa9_0,zynq_fsbl 
platform generate -domains standalone_ps7_cortexa9_0,zynq_fsbl 
platform generate -domains standalone_ps7_cortexa9_0,zynq_fsbl 
platform clean
platform generate
